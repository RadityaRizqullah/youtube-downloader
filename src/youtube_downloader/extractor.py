import re
import shutil
from typing import Any
import yt_dlp  # type: ignore[import-untyped]

YOUTUBE_VIDEO_PATTERN = re.compile(
    r"^(https?://)?((www|m)\.)?(youtube\.com/(watch\?.*v=|shorts/|embed/)|youtu\.be/)([\w-]{11})([^\s]*)$"
)

YOUTUBE_PLAYLIST_PATTERN = re.compile(
    r"^(https?://)?((www|m)\.)?youtube\.com/playlist\?([^\s]*&)?list=([\w-]+)([^\s]*)$"
)


def is_playlist_url(url: str) -> bool:
    trimmed = url.strip()
    return bool(
        YOUTUBE_PLAYLIST_PATTERN.match(trimmed)
        or ("list=" in trimmed and ("playlist" in trimmed or "watch" in trimmed))
    )


def is_valid_youtube_url(url: str) -> bool:
    trimmed = url.strip()
    return bool(YOUTUBE_VIDEO_PATTERN.match(trimmed) or is_playlist_url(trimmed))


def check_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def extract_video_info(url: str, cookies_from_browser: str | None = None, cookies_file: str | None = None) -> dict[str, Any]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        "noplaylist": True,
    }
    if cookies_file:
        ydl_opts["cookiefile"] = cookies_file
    elif cookies_from_browser:
        ydl_opts["cookiesfrombrowser"] = (cookies_from_browser,)
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


# ponytail: extract_flat=True fetches manifest without per-item downloads; upgrade to paginated batches if playlist length > 1000
def extract_playlist_info(url: str, cookies_from_browser: str | None = None, cookies_file: str | None = None) -> dict[str, Any]:
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    if cookies_file:
        ydl_opts["cookiefile"] = cookies_file
    elif cookies_from_browser:
        ydl_opts["cookiesfrombrowser"] = (cookies_from_browser,)
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if not info:
            raise ValueError("No playlist metadata returned by yt-dlp")

        raw_entries = info.get("entries") or []
        videos: list[dict[str, Any]] = []

        for entry in raw_entries:
            if not entry:
                continue
            video_id = entry.get("id") or ""
            video_url = entry.get("url")
            if not video_url or not is_valid_youtube_url(video_url):
                if video_id:
                    video_url = f"https://www.youtube.com/watch?v={video_id}"
                else:
                    continue

            thumb = entry.get("thumbnail") or ""
            if not thumb and entry.get("thumbnails"):
                thumbs = entry["thumbnails"]
                if isinstance(thumbs, list) and len(thumbs) > 0:
                    thumb = thumbs[-1].get("url") or ""
            if not thumb and video_id:
                thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

            videos.append(
                {
                    "url": video_url,
                    "title": entry.get("title") or "Unknown Title",
                    "uploader": entry.get("uploader")
                    or entry.get("channel")
                    or info.get("uploader")
                    or "Unknown Uploader",
                    "duration_s": int(entry.get("duration") or 0),
                    "thumbnail": thumb,
                    "available_qualities": [],
                }
            )

        return {
            "url": url,
            "title": info.get("title") or "Unknown Playlist",
            "uploader": info.get("uploader") or info.get("channel") or "Unknown Uploader",
            "video_count": len(videos),
            "videos": videos,
        }
