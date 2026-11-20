import pytest
from youtube_downloader.downloader import build_ydl_opts
from youtube_downloader.models import DownloadJob


def test_build_ydl_opts_video_best_mp4():
    job = DownloadJob(
        format="mp4",
        quality="best",
        audio_only=False,
    )
    opts = build_ydl_opts(job, outtmpl="/tmp/test.%(ext)s")
    assert opts["format"] == "bestvideo+bestaudio/best"
    assert opts["merge_output_format"] == "mp4"
    assert opts["outtmpl"] == "/tmp/test.%(ext)s"


def test_build_ydl_opts_video_specific_resolution_mkv():
    job = DownloadJob(
        format="mkv",
        quality="1080p",
        audio_only=False,
    )
    opts = build_ydl_opts(job)
    assert opts["format"] == "bestvideo[height<=1080]+bestaudio/best[height<=1080]"
    assert opts["merge_output_format"] == "mkv"


def test_build_ydl_opts_audio_only_mp3_320k():
    job = DownloadJob(
        format="mp3",
        quality="320k",
        audio_only=True,
    )
    opts = build_ydl_opts(job)
    assert opts["format"] == "bestaudio/best"
    assert "merge_output_format" not in opts
    assert len(opts["postprocessors"]) == 1
    pp = opts["postprocessors"][0]
    assert pp["key"] == "FFmpegExtractAudio"
    assert pp["preferredcodec"] == "mp3"
    assert pp["preferredquality"] == "320"


def test_build_ydl_opts_audio_only_best():
    job = DownloadJob(
        format="opus",
        quality="best",
        audio_only=True,
    )
    opts = build_ydl_opts(job)
    assert opts["format"] == "bestaudio/best"
    pp = opts["postprocessors"][0]
    assert pp["preferredcodec"] == "opus"
    assert pp["preferredquality"] == "0"


def test_build_ydl_opts_clip_ranges():
    job = DownloadJob(
        format="mp4",
        quality="best",
        audio_only=False,
        start_time_s=15,
        end_time_s=45,
    )
    opts = build_ydl_opts(job)
    assert "download_ranges" in opts
    assert "force_keyframes_at_cuts" not in opts


def test_format_seconds_tag():
    from youtube_downloader.downloader import format_seconds_tag
    assert format_seconds_tag(0) == "00-00"
    assert format_seconds_tag(90) == "01-30"
    assert format_seconds_tag(3665) == "01-01-05"


def test_run_download_job_merging_state_broadcast():
    from unittest.mock import MagicMock, patch
    import asyncio
    import uuid
    from youtube_downloader.database import SessionLocal
    from youtube_downloader.downloader import run_download_job
    from youtube_downloader.models import JobState

    job_id = f"job-{uuid.uuid4()}"
    db = SessionLocal()
    job = DownloadJob(
        id=job_id,
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        format="mkv",
        quality="1080p",
        audio_only=False,
        state=JobState.PENDING.value,
        progress=0.0,
    )
    db.add(job)
    db.commit()
    db.close()

    broadcast_messages = []

    async def mock_broadcast(msg):
        broadcast_messages.append(msg)

    loop = asyncio.new_event_loop()

    def fake_extract_info(url, download=True):
        # Find the postprocessor hook passed in ydl_opts
        opts = mock_ydl_instance.call_args[0][0]
        assert "postprocessor_hooks" in opts
        for hook in opts["postprocessor_hooks"]:
            hook({"status": "started", "postprocessor": "Merger"})
        return {
            "title": "Test Title",
            "uploader": "Test Uploader",
            "duration": 100,
            "_filename": "/tmp/Test Title.mkv",
        }

    mock_ydl_instance = MagicMock()
    mock_ydl_instance.return_value.__enter__.return_value.extract_info.side_effect = fake_extract_info

    with patch("youtube_downloader.downloader.yt_dlp.YoutubeDL", mock_ydl_instance), \
         patch("youtube_downloader.downloader.manager.broadcast", side_effect=mock_broadcast):
        run_download_job(job_id, loop)
        # Process any pending coroutines in loop
        loop.run_until_complete(asyncio.sleep(0.01))

    loop.close()

    states = [m["state"] for m in broadcast_messages]
    assert JobState.DOWNLOADING.value in states
    assert JobState.MERGING.value in states
    assert JobState.DONE.value in states

