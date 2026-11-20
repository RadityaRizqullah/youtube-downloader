from datetime import datetime, timezone
from enum import Enum
from typing import Optional
import uuid
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from youtube_downloader.database import Base


class JobState(str, Enum):
    PENDING = "PENDING"
    FETCHING = "FETCHING"
    DOWNLOADING = "DOWNLOADING"
    MERGING = "MERGING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"

    @classmethod
    def terminal_states(cls) -> set[str]:
        return {cls.DONE.value, cls.FAILED.value, cls.CANCELLED.value}

    @classmethod
    def active_states(cls) -> set[str]:
        return {cls.PENDING.value, cls.DOWNLOADING.value, cls.MERGING.value}


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    uploader: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_s: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    thumbnail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    format: Mapped[str] = mapped_column(String, default="mp4")
    quality: Mapped[str] = mapped_column(String, default="best")
    audio_only: Mapped[bool] = mapped_column(Boolean, default=False)
    start_time_s: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    end_time_s: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    state: Mapped[str] = mapped_column(String, default=JobState.PENDING.value)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    output_folder: Mapped[str] = mapped_column(Text, default="~/Downloads/youtube-downloader")
    max_concurrency: Mapped[int] = mapped_column(Integer, default=3)
    filename_template: Mapped[str] = mapped_column(Text, default="%(title)s.%(ext)s")
    default_format: Mapped[str] = mapped_column(String, default="mp4")
    default_quality: Mapped[str] = mapped_column(String, default="best")
    default_audio_format: Mapped[str] = mapped_column(String, default="mp3")
    default_audio_quality: Mapped[str] = mapped_column(String, default="best")
    cookies_from_browser: Mapped[Optional[str]] = mapped_column(String, nullable=True, default=None)
    cookies_file: Mapped[Optional[str]] = mapped_column(Text, nullable=True, default=None)
