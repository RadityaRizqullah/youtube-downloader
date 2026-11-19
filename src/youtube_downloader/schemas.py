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


class DownloadJobCreate(BaseModel):
    url: str
    title: Optional[str] = None
    uploader: Optional[str] = None
    duration_s: Optional[int] = None
    thumbnail: Optional[str] = None
    format: str = "mp4"
    quality: str = "best"
    audio_only: bool = False


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
