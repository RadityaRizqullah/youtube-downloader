from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    ffmpeg: bool
    version: str = "0.1.0"


class VideoMetadata(BaseModel):
    url: str
    title: str
    uploader: str
    duration_s: int
    thumbnail: str
    available_qualities: list[str] = []


class PlaylistMetadata(BaseModel):
    url: str
    title: str
    uploader: str = "Unknown Uploader"
    video_count: int
    videos: list[VideoMetadata] = []



class DownloadJobCreate(BaseModel):
    url: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration_s: Optional[int] = None
    thumbnail: Optional[str] = None
    format: str = "mp4"
    quality: str = "best"
    audio_only: bool = False
    start_time_s: Optional[int] = None
    end_time_s: Optional[int] = None


class DownloadJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    url: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration_s: Optional[int] = None
    thumbnail: Optional[str] = None
    format: str
    quality: str
    audio_only: bool
    start_time_s: Optional[int] = None
    end_time_s: Optional[int] = None
    state: str
    progress: float
    error: Optional[str] = None
    output_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobUpdateMessage(BaseModel):
    id: str
    state: str
    progress: float
    error: Optional[str] = None
    output_path: Optional[str] = None


class BatchDownloadRequest(BaseModel):
    urls: list[str]
    format: str = "mp4"
    quality: str = "best"
    audio_only: bool = False


class BatchDownloadError(BaseModel):
    url: str
    error: str


# ponytail: simple summary response model; ceiling is per-job metadata pre-extraction, upgrade when async preview requested
class BatchDownloadResponse(BaseModel):
    queued: list[DownloadJobRead]
    failed: list[BatchDownloadError]
    total_submitted: int
    total_queued: int
    total_failed: int


class VideoSelection(BaseModel):
    url: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration_s: Optional[int] = None
    thumbnail: Optional[str] = None


class PlaylistDownloadRequest(BaseModel):
    videos: list[VideoSelection] = []
    format: str = "mp4"
    quality: str = "best"
    audio_only: bool = False


class PlaylistDownloadError(BaseModel):
    url: str
    error: str


# ponytail: simple summary response model; ceiling is per-job metadata pre-extraction, upgrade when async preview requested
class PlaylistDownloadResponse(BaseModel):
    queued: list[DownloadJobRead]
    failed: list[PlaylistDownloadError]
    total_submitted: int
    total_queued: int
    total_failed: int


class SettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int = 1
    output_folder: str = "~/Downloads/youtube-downloader"
    max_concurrency: int = 3
    filename_template: str = "%(title)s.%(ext)s"
    default_format: str = "mp4"
    default_quality: str = "best"
    default_audio_format: str = "mp3"
    default_audio_quality: str = "best"
    cookies_from_browser: Optional[str] = None
    cookies_file: Optional[str] = None


class SettingsUpdate(BaseModel):
    output_folder: Optional[str] = None
    max_concurrency: Optional[int] = None
    filename_template: Optional[str] = None
    default_format: Optional[str] = None
    default_quality: Optional[str] = None
    default_audio_format: Optional[str] = None
    default_audio_quality: Optional[str] = None
    cookies_from_browser: Optional[str] = None
    cookies_file: Optional[str] = None

