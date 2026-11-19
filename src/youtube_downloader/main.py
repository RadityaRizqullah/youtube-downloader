import asyncio
from contextlib import asynccontextmanager
import logging
from typing import List, Optional, Union
from pathlib import Path
import uuid
from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from youtube_downloader.database import get_db, init_db
from youtube_downloader.extractor import (
    check_ffmpeg,
    extract_playlist_info,
    extract_video_info,
    is_playlist_url,
    is_valid_youtube_url,
)
from youtube_downloader.models import DownloadJob, JobState, Settings
from youtube_downloader.queue import QueueManager
from youtube_downloader.schemas import (
    BatchDownloadError,
    BatchDownloadRequest,
    BatchDownloadResponse,
    DownloadJobCreate,
    DownloadJobRead,
    HealthResponse,
    PlaylistDownloadError,
    PlaylistDownloadRequest,
    PlaylistDownloadResponse,
    PlaylistMetadata,
    SettingsRead,
    SettingsUpdate,
    VideoMetadata,
    VideoSelection,
)
from youtube_downloader.ws import manager

queue_manager = QueueManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if not check_ffmpeg():
        logging.getLogger("uvicorn.error").warning(
            "FFmpeg not found on system PATH. High-resolution merging will fail."
        )
    await queue_manager.startup()
    yield


app = FastAPI(title="YouTube Downloader API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
async def get_health():
    return HealthResponse(ffmpeg=check_ffmpeg())


VALID_VIDEO_FORMATS = {"mp4", "webm", "mkv"}
VALID_VIDEO_QUALITIES = {"best", "1080p", "720p", "480p", "360p"}
VALID_AUDIO_FORMATS = {"mp3", "m4a", "opus"}
VALID_AUDIO_QUALITIES = {"best", "320k", "192k", "128k"}


@app.get("/api/settings", response_model=SettingsRead)
async def get_settings(db: Session = Depends(get_db)):
    settings = db.query(Settings).first()
    if not settings:
        settings = Settings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


# ponytail: synchronous write probe for local paths; upgrade to async storage validation if cloud/network mounts supported
@app.put("/api/settings", response_model=SettingsRead)
async def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(Settings).first()
    if not settings:
        settings = Settings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    if payload.max_concurrency is not None:
        if payload.max_concurrency < 1 or payload.max_concurrency > 10:
            raise HTTPException(
                status_code=400,
                detail="Max concurrency must be between 1 and 10",
            )
        settings.max_concurrency = payload.max_concurrency
        await queue_manager.update_concurrency(payload.max_concurrency)

    if payload.output_folder is not None:
        folder_str = payload.output_folder.strip()
        if not folder_str:
            raise HTTPException(status_code=400, detail="Output folder cannot be empty")
        try:
            folder_path = Path(folder_str).expanduser()
            folder_path.mkdir(parents=True, exist_ok=True)
            probe = folder_path / f".write_test_{uuid.uuid4().hex}"
            probe.touch(exist_ok=False)
            probe.unlink(missing_ok=True)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Output folder is not writable or cannot be created: {exc}",
            )
        settings.output_folder = folder_str

    if payload.filename_template is not None:
        tmpl = payload.filename_template.strip()
        if not tmpl:
            raise HTTPException(status_code=400, detail="Filename template cannot be empty")
        if "%(ext)s" not in tmpl:
            raise HTTPException(
                status_code=400,
                detail="Filename template must include '%(ext)s' container extension placeholder",
            )
        tmpl_path = Path(tmpl)
        if (
            tmpl.startswith(("/", "\\"))
            or tmpl_path.is_absolute()
            or (len(tmpl) > 1 and tmpl[1] == ":")
            or ".." in tmpl_path.parts
        ):
            raise HTTPException(
                status_code=400,
                detail="Filename template cannot be absolute or contain directory traversal",
            )
        settings.filename_template = tmpl

    if payload.default_format is not None:
        if payload.default_format not in VALID_VIDEO_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid default video format. Allowed: {sorted(VALID_VIDEO_FORMATS)}",
            )
        settings.default_format = payload.default_format

    if payload.default_quality is not None:
        if payload.default_quality not in VALID_VIDEO_QUALITIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid default video quality. Allowed: {sorted(VALID_VIDEO_QUALITIES)}",
            )
        settings.default_quality = payload.default_quality

    if payload.default_audio_format is not None:
        if payload.default_audio_format not in VALID_AUDIO_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid default audio format. Allowed: {sorted(VALID_AUDIO_FORMATS)}",
            )
        settings.default_audio_format = payload.default_audio_format

    if payload.default_audio_quality is not None:
        if payload.default_audio_quality not in VALID_AUDIO_QUALITIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid default audio quality. Allowed: {sorted(VALID_AUDIO_QUALITIES)}",
            )
        settings.default_audio_quality = payload.default_audio_quality

    db.commit()
    db.refresh(settings)
    return settings



@app.get("/api/info", response_model=Union[PlaylistMetadata, VideoMetadata])
async def get_info(
    url: str = Query(..., description="YouTube video or playlist URL"),
    playlist: Optional[bool] = Query(None, description="Force playlist extraction if URL contains a playlist"),
):
    if not is_valid_youtube_url(url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL format")
    try:
        is_pl = is_playlist_url(url) if playlist is None else (playlist or is_playlist_url(url))
        if is_pl:
            data = await asyncio.to_thread(extract_playlist_info, url)
            return PlaylistMetadata(**data)
        else:
            data = await asyncio.to_thread(extract_video_info, url)
            return VideoMetadata(**data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to extract info: {exc}")



@app.post("/api/jobs", response_model=DownloadJobRead, status_code=status.HTTP_201_CREATED)
async def create_job(payload: DownloadJobCreate, db: Session = Depends(get_db)):
    if not is_valid_youtube_url(payload.url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL format")

    job = DownloadJob(
        url=payload.url,
        title=payload.title,
        uploader=payload.uploader,
        duration_s=payload.duration_s,
        thumbnail=payload.thumbnail,
        format=payload.format,
        quality=payload.quality,
        audio_only=payload.audio_only,
        state=JobState.PENDING.value,
        progress=0.0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    await queue_manager.enqueue(str(job.id))

    return job


# ponytail: sequential enqueue loop; upgrade to batch job dispatch if queue throughput bottlenecks
@app.post("/api/jobs/batch", response_model=BatchDownloadResponse, status_code=status.HTTP_201_CREATED)
async def create_batch_jobs(payload: BatchDownloadRequest, db: Session = Depends(get_db)):
    queued_jobs: list[DownloadJob] = []
    failed: list[BatchDownloadError] = []
    total_submitted = 0

    for raw_url in payload.urls:
        url = raw_url.strip()
        if not url:
            continue
        total_submitted += 1
        if not is_valid_youtube_url(url):
            failed.append(BatchDownloadError(url=url, error="Invalid YouTube URL format"))
            continue

        job = DownloadJob(
            url=url,
            format=payload.format,
            quality=payload.quality,
            audio_only=payload.audio_only,
            state=JobState.PENDING.value,
            progress=0.0,
        )
        db.add(job)
        queued_jobs.append(job)

    db.commit()

    for job in queued_jobs:
        db.refresh(job)
        await queue_manager.enqueue(str(job.id))

    return BatchDownloadResponse(
        queued=[DownloadJobRead.model_validate(j) for j in queued_jobs],
        failed=failed,
        total_submitted=total_submitted,
        total_queued=len(queued_jobs),
        total_failed=len(failed),
    )


# ponytail: sequential enqueue loop; upgrade to bulk insert/enqueue if playlist selection > 500
@app.post("/api/jobs/playlist", response_model=PlaylistDownloadResponse, status_code=status.HTTP_201_CREATED)
async def create_playlist_jobs(payload: PlaylistDownloadRequest, db: Session = Depends(get_db)):
    queued_jobs: list[DownloadJob] = []
    failed: list[PlaylistDownloadError] = []
    total_submitted = 0

    for video in payload.videos:
        url = video.url.strip()
        if not url:
            continue
        total_submitted += 1
        if not is_valid_youtube_url(url):
            failed.append(PlaylistDownloadError(url=url, error="Invalid YouTube URL format"))
            continue

        job = DownloadJob(
            url=url,
            title=video.title,
            uploader=video.uploader,
            duration_s=video.duration_s,
            thumbnail=video.thumbnail,
            format=payload.format,
            quality=payload.quality,
            audio_only=payload.audio_only,
            state=JobState.PENDING.value,
            progress=0.0,
        )
        db.add(job)
        queued_jobs.append(job)

    db.commit()

    for job in queued_jobs:
        db.refresh(job)
        await queue_manager.enqueue(str(job.id))

    return PlaylistDownloadResponse(
        queued=[DownloadJobRead.model_validate(j) for j in queued_jobs],
        failed=failed,
        total_submitted=total_submitted,
        total_queued=len(queued_jobs),
        total_failed=len(failed),
    )




@app.post("/api/jobs/{job_id}/cancel", response_model=DownloadJobRead)
async def cancel_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await queue_manager.cancel(job_id)
    db.refresh(job)
    return job


@app.post("/api/jobs/cancel-all")
async def cancel_all_jobs():
    count = await queue_manager.cancel_all()
    return {"cancelled": count}


@app.post("/api/jobs/{job_id}/retry", response_model=DownloadJobRead)
async def retry_job(job_id: str, db: Session = Depends(get_db)):
    retried = await queue_manager.retry(job_id)
    if not retried:
        job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(status_code=400, detail="Only failed jobs can be retried")
    return retried


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.state not in JobState.terminal_states():
        raise HTTPException(status_code=400, detail="Cannot delete an active job")
    await queue_manager.delete_job(job_id)
    return {"deleted": True}


@app.post("/api/jobs/clear-completed")
async def clear_completed_jobs():
    count = await queue_manager.clear_completed()
    return {"cleared": count}


@app.get("/api/jobs", response_model=List[DownloadJobRead])
async def list_jobs(db: Session = Depends(get_db)):
    jobs = db.query(DownloadJob).order_by(DownloadJob.created_at.desc()).all()
    return jobs


@app.get("/api/jobs/{job_id}", response_model=DownloadJobRead)
async def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.websocket("/ws/jobs")
async def websocket_jobs(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection open; clients can send ping or text
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    if (FRONTEND_DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")

