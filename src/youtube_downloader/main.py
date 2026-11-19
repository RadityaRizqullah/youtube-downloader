import asyncio
from contextlib import asynccontextmanager
from typing import List
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from youtube_downloader.database import get_db, init_db
from youtube_downloader.downloader import run_download_job
from youtube_downloader.extractor import check_ffmpeg, extract_video_info, is_valid_youtube_url
from youtube_downloader.models import DownloadJob, JobState
from youtube_downloader.schemas import DownloadJobCreate, DownloadJobRead, HealthResponse, VideoMetadata
from youtube_downloader.ws import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
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


@app.get("/api/info", response_model=VideoMetadata)
async def get_info(url: str = Query(..., description="YouTube video URL")):
    if not is_valid_youtube_url(url):
        raise HTTPException(status_code=400, detail="Invalid YouTube URL format")
    try:
        data = extract_video_info(url)
        return VideoMetadata(**data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to extract video info: {exc}")


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

    loop = asyncio.get_running_loop()
    # ponytail: trigger download directly in thread; queuing / concurrency control in Issue #4
    loop.run_in_executor(None, run_download_job, str(job.id), loop)

    return job


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

