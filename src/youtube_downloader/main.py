import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional, Union
from pathlib import Path
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
from youtube_downloader.models import DownloadJob, JobState
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
    VideoMetadata,
    VideoSelection,
)
from youtube_downloader.ws import manager

queue_manager = QueueManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
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

