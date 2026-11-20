import asyncio
from pathlib import Path
import threading
from typing import Any
import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.utils import download_range_func  # type: ignore[import-untyped]

from sqlalchemy.orm import Session
from youtube_downloader.database import SessionLocal
from youtube_downloader.models import DownloadJob, JobState, Settings
from youtube_downloader.ws import manager


def get_default_output_folder(db: Session | None = None) -> Path:
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    try:
        settings = db.query(Settings).first()
        folder_str = settings.output_folder if settings and settings.output_folder else "~/Downloads/youtube-downloader"
        path = Path(folder_str).expanduser()
        path.mkdir(parents=True, exist_ok=True)
        return path
    finally:
        if close_db:
            db.close()


def format_seconds_tag(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h:02d}-{m:02d}-{s:02d}"
    return f"{m:02d}-{s:02d}"


def build_ydl_opts(job: DownloadJob, outtmpl: str | None = None, cookies_from_browser: str | None = None, cookies_file: str | None = None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
    }
    if outtmpl:
        opts["outtmpl"] = outtmpl

    if cookies_file:
        opts["cookiefile"] = cookies_file
    elif cookies_from_browser:
        opts["cookiesfrombrowser"] = (cookies_from_browser,)

    if job.start_time_s is not None and job.end_time_s is not None:
        opts["download_ranges"] = download_range_func(None, [(job.start_time_s, job.end_time_s)])
        # ponytail: keyframe-copy trim (nearest keyframe); add force_keyframes_at_cuts=True only if frame-exact cuts are required (triggers full re-encode)

    if job.audio_only:
        opts["format"] = "bestaudio/best"
        codec = job.format if job.format in ("mp3", "m4a", "opus") else "mp3"
        quality_str = "0" if job.quality == "best" else job.quality.rstrip("k")
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": codec,
            "preferredquality": quality_str,
        }]
    else:
        container = job.format if job.format in ("mp4", "webm", "mkv") else "mp4"
        opts["merge_output_format"] = container
        if job.quality == "best" or not job.quality:
            opts["format"] = "bestvideo+bestaudio/best"
        else:
            height = job.quality.rstrip("p")
            opts["format"] = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]"

    return opts


class DownloadCancelled(Exception):
    pass


def run_download_job(
    job_id: str,
    loop: asyncio.AbstractEventLoop,
    cancel_event: threading.Event | None = None,
) -> None:
    db = SessionLocal()
    job: DownloadJob | None = None
    try:
        job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        if not job:
            return

        settings = db.query(Settings).first()
        out_dir = get_default_output_folder(db)
        tmpl = settings.filename_template if settings and settings.filename_template else "%(title)s.%(ext)s"
        cookies_from_browser = settings.cookies_from_browser if settings else None
        cookies_file = settings.cookies_file if settings else None
        p_tmpl = Path(tmpl)
        if (
            tmpl.startswith(("/", "\\"))
            or p_tmpl.is_absolute()
            or (len(tmpl) > 1 and tmpl[1] == ":")
            or ".." in p_tmpl.parts
        ):
            tmpl = "%(title)s.%(ext)s"

        if job.start_time_s is not None and job.end_time_s is not None:
            start_str = format_seconds_tag(job.start_time_s)
            end_str = format_seconds_tag(job.end_time_s)
            clip_suffix = f" [{start_str}_{end_str}]"
            if ".%(ext)s" in tmpl:
                tmpl = tmpl.replace(".%(ext)s", f"{clip_suffix}.%(ext)s")
            else:
                tmpl = f"{tmpl}{clip_suffix}"

        template = str(out_dir / tmpl)

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
            if cancel_event and cancel_event.is_set():
                raise DownloadCancelled("Job cancelled by user")
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

        def postprocessor_hook(d: dict[str, Any]) -> None:
            if not job:
                return
            if cancel_event and cancel_event.is_set():
                raise DownloadCancelled("Job cancelled by user")
            status = d.get("status")
            if status == "started":
                job.state = JobState.MERGING.value
                db.commit()
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "id": job.id,
                        "state": JobState.MERGING.value,
                        "progress": job.progress,
                        "error": None,
                        "output_path": None,
                    }),
                    loop,
                )
            elif status == "finished":
                info_dict = d.get("info_dict") or {}
                filename = info_dict.get("filepath") or d.get("filepath") or d.get("filename")
                if filename:
                    final_path.append(filename)

        ydl_opts = build_ydl_opts(job, outtmpl=template, cookies_from_browser=cookies_from_browser, cookies_file=cookies_file)
        ydl_opts.setdefault("progress_hooks", []).append(progress_hook)
        ydl_opts.setdefault("postprocessor_hooks", []).append(postprocessor_hook)

        if cancel_event and cancel_event.is_set():
            raise DownloadCancelled("Job cancelled by user")

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
                    out_file = final_path[-1]
                elif "_filename" in info:
                    out_file = info["_filename"]
                job.output_path = out_file

        if cancel_event and cancel_event.is_set():
            raise DownloadCancelled("Job cancelled by user")

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

    except DownloadCancelled:
        if job:
            job.state = JobState.CANCELLED.value
            job.error = "Cancelled by user"
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
