import asyncio
from pathlib import Path
from typing import Any
import yt_dlp  # type: ignore[import-untyped]

from youtube_downloader.database import SessionLocal
from youtube_downloader.models import DownloadJob, JobState, Settings
from youtube_downloader.ws import manager


def get_default_output_folder() -> Path:
    db = SessionLocal()
    try:
        settings = db.query(Settings).first()
        folder_str = settings.output_folder if settings and settings.output_folder else "~/Downloads/youtube-downloader"
        path = Path(folder_str).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    finally:
        db.close()


def run_download_job(job_id: str, loop: asyncio.AbstractEventLoop) -> None:
    db = SessionLocal()
    job: DownloadJob | None = None
    try:
        job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        if not job:
            return

        out_dir = get_default_output_folder()
        template = str(out_dir / "%(title)s.%(ext)s")

        job.state = JobState.DOWNLOADING.value
        db.commit()

        asyncio.run_coroutine_threadsafe(
            manager.broadcast({
                "id": job.id,
                "state": job.state,
                "progress": job.progress,
                "error": None,
                "output_path": None,
            }),
            loop,
        )

        final_path: list[str] = []

        def progress_hook(d: dict[str, Any]) -> None:
            if not job:
                return
            status = d.get("status")
            if status == "downloading":
                total = float(d.get("total_bytes") or d.get("total_bytes_estimate") or 0.0)
                downloaded = float(d.get("downloaded_bytes") or 0.0)
                pct = round((downloaded / total * 100), 1) if total > 0 else 0.0
                job.progress = pct
                db.commit()
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "id": job.id,
                        "state": JobState.DOWNLOADING.value,
                        "progress": pct,
                        "error": None,
                        "output_path": None,
                    }),
                    loop,
                )
            elif status == "finished":
                filename = d.get("filename")
                if filename:
                    final_path.append(filename)

        ydl_opts: dict[str, Any] = {
            "outtmpl": template,
            "progress_hooks": [progress_hook],
            "quiet": True,
            "no_warnings": True,
        }

        # Format handling: default video format mp4
        if job.audio_only:
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": job.format or "mp3",
                "preferredquality": "192",
            }]
        else:
            ydl_opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(job.url, download=True)
            if info:
                # Update title and uploader if missing
                if not job.title:
                    job.title = info.get("title")
                if not job.uploader:
                    job.uploader = info.get("uploader")
                if not job.duration_s:
                    job.duration_s = int(info.get("duration") or 0)
                if not job.thumbnail:
                    job.thumbnail = info.get("thumbnail")

                out_file = None
                if final_path:
                    out_file = final_path[0]
                elif "_filename" in info:
                    out_file = info["_filename"]
                job.output_path = out_file

        job.state = JobState.DONE.value
        job.progress = 100.0
        db.commit()

        asyncio.run_coroutine_threadsafe(
            manager.broadcast({
                "id": job.id,
                "state": job.state,
                "progress": 100.0,
                "error": None,
                "output_path": job.output_path,
            }),
            loop,
        )

    except Exception as exc:
        if job:
            job.state = JobState.FAILED.value
            job.error = str(exc)
            db.commit()
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({
                    "id": job.id,
                    "state": job.state,
                    "progress": job.progress,
                    "error": job.error,
                    "output_path": None,
                }),
                loop,
            )
    finally:
        db.close()
