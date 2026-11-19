import re
import shutil
from typing import Any
import yt_dlp  # type: ignore[import-untyped]

YOUTUBE_URL_PATTERN = re.compile(
    r"^(https?://)?((www|m)\.)?(youtube\.com/(watch\?.*v=|shorts/|embed/)|youtu\.be/)([\w-]{11})([^\s]*)$"
)


def is_valid_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_URL_PATTERN.match(url.strip()))


def check_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def extract_video_info(url: str) -> dict[str, Any]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("No video metadata returned by yt-dlp")

        formats = info.get("formats") or []
        qualities_set: set[int] = set()
        for f in formats:
            if f.get("vcodec") and f.get("vcodec") != "none" and f.get("height"):
                qualities_set.add(int(f["height"]))

        available_qualities = [f"{h}p" for h in sorted(qualities_set, reverse=True)]

        return {
            "url": url,
            "title": info.get("title") or "Unknown Title",
            "uploader": info.get("uploader") or info.get("channel") or "Unknown Uploader",
            "duration_s": int(info.get("duration") or 0),
            "thumbnail": info.get("thumbnail") or "",
            "available_qualities": available_qualities,
        }
