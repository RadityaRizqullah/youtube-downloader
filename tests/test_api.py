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
    with patch("youtube_downloader.main.queue_manager.enqueue"):
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


@pytest.mark.asyncio
async def test_api_cancel_and_cancel_all():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create a job
        with patch("youtube_downloader.main.queue_manager.enqueue"):
            res = await client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
            assert res.status_code == 201
            job_id = res.json()["id"]

            # Cancel single job
            cancel_res = await client.post(f"/api/jobs/{job_id}/cancel")
            assert cancel_res.status_code == 200
            assert cancel_res.json()["state"] == "CANCELLED"

            # Create another job and cancel all
            res2 = await client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
            assert res2.status_code == 201
            j2_id = res2.json()["id"]

            cancel_all_res = await client.post("/api/jobs/cancel-all")
            assert cancel_all_res.status_code == 200
            assert cancel_all_res.json()["cancelled"] >= 1

            check = await client.get(f"/api/jobs/{j2_id}")
            assert check.json()["state"] == "CANCELLED"


@pytest.mark.asyncio
async def test_api_retry_and_clear():
    from youtube_downloader.database import SessionLocal
    from youtube_downloader.models import DownloadJob, JobState
    import uuid

    job_id = f"api-test-{uuid.uuid4()}"
    # Seed a failed job
    db = SessionLocal()
    failed_job = DownloadJob(
        id=job_id,
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        state=JobState.FAILED.value,
        error="Sample error",
        progress=10.0,
    )
    db.add(failed_job)
    db.commit()
    db.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("youtube_downloader.main.queue_manager.enqueue"):
            # Retry failed job
            retry_res = await client.post(f"/api/jobs/{job_id}/retry")
            assert retry_res.status_code == 200
            retried = retry_res.json()
            assert retried["state"] == "PENDING"
            assert retried["error"] is None
            assert retried["progress"] == 0.0

        # Mark it cancelled so we can test delete
        db = SessionLocal()
        j = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        j.state = JobState.CANCELLED.value
        db.commit()
        db.close()

        # Delete single terminal job
        del_res = await client.delete(f"/api/jobs/{job_id}")
        assert del_res.status_code == 200

        # Clear completed
        clear_res = await client.post("/api/jobs/clear-completed")
        assert clear_res.status_code == 200
        assert "cleared" in clear_res.json()


@pytest.mark.asyncio
async def test_batch_create_download_jobs():
    with patch("youtube_downloader.main.queue_manager.enqueue") as mock_enqueue:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {
                "urls": [
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    "   ",
                    "not-a-valid-url",
                    "https://youtu.be/9bZkp7q19f0",
                ],
                "format": "mp3",
                "quality": "320k",
                "audio_only": True,
            }
            response = await client.post("/api/jobs/batch", json=payload)
            assert response.status_code == 201
            data = response.json()
            assert data["total_submitted"] == 3
            assert data["total_queued"] == 2
            assert data["total_failed"] == 1
            assert len(data["queued"]) == 2
            assert len(data["failed"]) == 1
            assert data["failed"][0]["url"] == "not-a-valid-url"
            assert "Invalid YouTube URL" in data["failed"][0]["error"]

            for job in data["queued"]:
                assert job["state"] == "PENDING"
                assert job["audio_only"] is True
                assert job["format"] == "mp3"
                assert job["quality"] == "320k"

            assert mock_enqueue.call_count == 2


@pytest.mark.asyncio
async def test_batch_all_invalid_urls():
    with patch("youtube_downloader.main.queue_manager.enqueue") as mock_enqueue:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {
                "urls": ["invalid-1", "invalid-2"],
                "format": "mp4",
                "quality": "best",
                "audio_only": False,
            }
            response = await client.post("/api/jobs/batch", json=payload)
            assert response.status_code == 201
            data = response.json()
            assert data["total_submitted"] == 2
            assert data["total_queued"] == 0
            assert data["total_failed"] == 2
            assert len(data["queued"]) == 0
            assert len(data["failed"]) == 2
            assert mock_enqueue.call_count == 0


@pytest.mark.asyncio
async def test_info_returns_playlist_metadata_for_playlist_url():
    mock_playlist = {
        "url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4",
        "title": "Lex Fridman Podcast",
        "uploader": "Lex Fridman",
        "video_count": 2,
        "videos": [
            {
                "url": "https://www.youtube.com/watch?v=vid1",
                "title": "Video 1",
                "uploader": "Lex Fridman",
                "duration_s": 120,
                "thumbnail": "https://example.com/thumb1.jpg",
                "available_qualities": [],
            },
            {
                "url": "https://www.youtube.com/watch?v=vid2",
                "title": "Video 2",
                "uploader": "Lex Fridman",
                "duration_s": 240,
                "thumbnail": "https://example.com/thumb2.jpg",
                "available_qualities": [],
            },
        ],
    }
    with patch("youtube_downloader.main.extract_playlist_info", return_value=mock_playlist):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(
                "/api/info",
                params={"url": "https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["title"] == "Lex Fridman Podcast"
            assert data["uploader"] == "Lex Fridman"
            assert data["video_count"] == 2
            assert len(data["videos"]) == 2
            assert data["videos"][0]["title"] == "Video 1"
            assert data["videos"][1]["duration_s"] == 240


@pytest.mark.asyncio
async def test_create_playlist_jobs_expands_selection_into_pending_jobs():
    with patch("youtube_downloader.main.queue_manager.enqueue") as mock_enqueue:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            payload = {
                "videos": [
                    {
                        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                        "title": "Track 1",
                        "uploader": "Artist 1",
                        "duration_s": 200,
                        "thumbnail": "https://example.com/t1.jpg",
                    },
                    {
                        "url": "https://www.youtube.com/watch?v=9bZkp7q19f0",
                        "title": "Track 2",
                        "uploader": "Artist 2",
                        "duration_s": 250,
                        "thumbnail": "https://example.com/t2.jpg",
                    },
                ],
                "format": "mp4",
                "quality": "720p",
                "audio_only": False,
            }
            response = await client.post("/api/jobs/playlist", json=payload)
            assert response.status_code == 201
            data = response.json()
            assert data["total_submitted"] == 2
            assert data["total_queued"] == 2
            assert data["total_failed"] == 0
            assert len(data["queued"]) == 2

            for job in data["queued"]:
                assert job["state"] == "PENDING"
                assert job["format"] == "mp4"
                assert job["quality"] == "720p"
                assert job["audio_only"] is False

            assert mock_enqueue.call_count == 2


@pytest.mark.asyncio
async def test_get_settings():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "output_folder" in data
        assert "max_concurrency" in data
        assert "filename_template" in data
        assert "default_format" in data
        assert "default_quality" in data
        assert "default_audio_format" in data
        assert "default_audio_quality" in data


@pytest.mark.asyncio
async def test_update_settings_valid(tmp_path):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        out_folder = str(tmp_path / "downloads")
        payload = {
            "output_folder": out_folder,
            "max_concurrency": 5,
            "filename_template": "%(uploader)s - %(title)s.%(ext)s",
            "default_format": "mkv",
            "default_quality": "1080p",
            "default_audio_format": "m4a",
            "default_audio_quality": "320k",
        }
        response = await client.put("/api/settings", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["output_folder"] == out_folder
        assert data["max_concurrency"] == 5
        assert data["filename_template"] == "%(uploader)s - %(title)s.%(ext)s"
        assert data["default_format"] == "mkv"
        assert data["default_quality"] == "1080p"
        assert data["default_audio_format"] == "m4a"
        assert data["default_audio_quality"] == "320k"


@pytest.mark.asyncio
async def test_update_settings_rejects_invalid_concurrency():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Concurrency 0 (< 1)
        res = await client.put("/api/settings", json={"max_concurrency": 0})
        assert res.status_code in (400, 422)

        # Concurrency 11 (> 10)
        res = await client.put("/api/settings", json={"max_concurrency": 11})
        assert res.status_code in (400, 422)


@pytest.mark.asyncio
async def test_update_settings_rejects_invalid_output_folder(monkeypatch):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Non-writable or OS permission error
        def mock_mkdir_fail(*args, **kwargs):
            raise PermissionError("Access denied")

        monkeypatch.setattr("pathlib.Path.mkdir", mock_mkdir_fail)
        res = await client.put("/api/settings", json={"output_folder": "/protected/directory"})
        assert res.status_code == 400
        assert "not writable" in res.json()["detail"].lower() or "invalid" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_update_settings_rejects_invalid_format():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.put("/api/settings", json={"default_format": "avi"})
        assert res.status_code in (400, 422)


@pytest.mark.asyncio
async def test_update_settings_rejects_invalid_filename_template():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Missing %(ext)s
        res = await client.put("/api/settings", json={"filename_template": "video_without_ext"})
        assert res.status_code == 400
        assert "%(ext)s" in res.json()["detail"]

        # Empty template
        res = await client.put("/api/settings", json={"filename_template": "   "})
        assert res.status_code == 400

        # Directory traversal
        res = await client.put("/api/settings", json={"filename_template": "../%(title)s.%(ext)s"})
        assert res.status_code == 400
        assert "directory traversal" in res.json()["detail"]

        # Absolute path
        res = await client.put("/api/settings", json={"filename_template": "/tmp/%(title)s.%(ext)s"})
        assert res.status_code == 400
        assert "absolute" in res.json()["detail"]








