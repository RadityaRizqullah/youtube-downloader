import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch
from starlette.testclient import TestClient

from youtube_downloader.main import app
from youtube_downloader.ws import manager


@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert "ffmpeg" in data
        assert isinstance(data["ffmpeg"], bool)
        assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_info_rejects_invalid_url():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/info", params={"url": "https://example.com/not-youtube"})
        assert response.status_code == 400
        assert "Invalid YouTube URL" in response.json()["detail"]


@pytest.mark.asyncio
async def test_info_returns_metadata_for_valid_url():
    mock_metadata = {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "Rick Astley - Never Gonna Give You Up",
        "uploader": "Rick Astley",
        "duration_s": 213,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }
    with patch("youtube_downloader.main.extract_video_info", return_value=mock_metadata):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/info", params={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
            assert response.status_code == 200
            data = response.json()
            assert data["title"] == "Rick Astley - Never Gonna Give You Up"
            assert data["uploader"] == "Rick Astley"
            assert data["duration_s"] == 213
            assert data["thumbnail"] == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"


@pytest.mark.asyncio
async def test_create_download_job():
    with patch("youtube_downloader.main.run_download_job"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "title": "Never Gonna Give You Up",
                "uploader": "Rick Astley",
                "duration_s": 213,
                "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            }
            response = await client.post("/api/jobs", json=payload)
            assert response.status_code == 201
            data = response.json()
            assert "id" in data
            assert data["url"] == payload["url"]
            assert data["title"] == payload["title"]
            assert data["state"] == "PENDING"
            assert data["progress"] == 0.0

            # Verify job is listed in GET /api/jobs
            list_response = await client.get("/api/jobs")
            assert list_response.status_code == 200
            jobs = list_response.json()
            assert len(jobs) >= 1
            assert any(j["id"] == data["id"] for j in jobs)


def test_websocket_broadcast():
    client = TestClient(app)
    with client.websocket_connect("/ws/jobs") as websocket:
        # Simulate a broadcast
        import asyncio
        loop = asyncio.new_event_loop()
        loop.run_until_complete(
            manager.broadcast({
                "id": "job-123",
                "state": "DOWNLOADING",
                "progress": 42.5,
                "error": None,
                "output_path": None,
            })
        )
        loop.close()

        data = websocket.receive_json()
        assert data["id"] == "job-123"
        assert data["state"] == "DOWNLOADING"
        assert data["progress"] == 42.5


def test_download_job_failure_updates_state():
    from youtube_downloader.database import SessionLocal
    from youtube_downloader.downloader import run_download_job
    from youtube_downloader.models import DownloadJob, JobState
    import asyncio
    import uuid

    job_id = f"job-{uuid.uuid4()}"
    db = SessionLocal()
    job = DownloadJob(
        id=job_id,
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        state=JobState.PENDING.value,
        progress=0.0,
    )
    db.add(job)
    db.commit()
    db.close()

    loop = asyncio.new_event_loop()
    with patch("yt_dlp.YoutubeDL") as mock_ydl:
        mock_ydl.return_value.__enter__.return_value.extract_info.side_effect = RuntimeError("Extraction failed")
        run_download_job(job_id, loop)
        loop.run_until_complete(asyncio.sleep(0.01))
    loop.close()

    db = SessionLocal()
    updated = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
    assert updated is not None
    assert updated.state == JobState.FAILED.value
    assert "Extraction failed" in (updated.error or "")
    db.close()


@pytest.mark.asyncio
async def test_serves_spa_index():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/")
        assert response.status_code == 200
        assert "html" in response.headers.get("content-type", "")


