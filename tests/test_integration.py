import asyncio
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import MagicMock, patch
from starlette.testclient import TestClient

from youtube_downloader.downloader import get_default_output_folder
from youtube_downloader.main import app
from youtube_downloader.models import JobState


@pytest.mark.asyncio
async def test_full_walking_skeleton_flow(tmp_path: Path):
    test_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    output_dir = tmp_path / "downloads"
    output_dir.mkdir(parents=True, exist_ok=True)

    expected_file = output_dir / "Test Video.mp4"

    # Step 1: Reject malformed URL
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        bad_res = await client.get("/api/info", params={"url": "https://invalid-url.com"})
        assert bad_res.status_code == 400

    # Step 2: Metadata fetch for valid URL
    mock_meta = {
        "url": test_url,
        "title": "Test Video",
        "uploader": "Test Channel",
        "duration_s": 120,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }
    with patch("youtube_downloader.main.extract_video_info", return_value=mock_meta):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            info_res = await client.get("/api/info", params={"url": test_url})
            assert info_res.status_code == 200
            metadata = info_res.json()
            assert metadata["title"] == "Test Video"
            assert metadata["uploader"] == "Test Channel"
            assert metadata["duration_s"] == 120

    # Step 3: URL submission -> job creation -> background execution writing file to disk
    def fake_extract_info(url: str, download: bool = True):
        # Write real file to output directory to simulate completed download
        expected_file.write_bytes(b"dummy video data content")
        return {
            "title": "Test Video",
            "uploader": "Test Channel",
            "duration": 120,
            "_filename": str(expected_file),
        }

    mock_ydl_instance = MagicMock()
    mock_ydl_instance.__enter__.return_value.extract_info.side_effect = fake_extract_info

    with patch("youtube_downloader.downloader.get_default_output_folder", return_value=output_dir), \
         patch("yt_dlp.YoutubeDL", return_value=mock_ydl_instance):

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            job_payload = {
                "url": test_url,
                "title": metadata["title"],
                "uploader": metadata["uploader"],
                "duration_s": metadata["duration_s"],
                "thumbnail": metadata["thumbnail"],
            }
            create_res = await client.post("/api/jobs", json=job_payload)
            assert create_res.status_code == 201
            job_data = create_res.json()
            job_id = job_data["id"]

            # Wait briefly for background thread to execute
            for _ in range(50):
                await asyncio.sleep(0.05)
                get_res = await client.get(f"/api/jobs/{job_id}")
                assert get_res.status_code == 200
                current_job = get_res.json()
                if current_job["state"] in (JobState.DONE.value, JobState.FAILED.value):
                    break

            assert current_job["state"] == JobState.DONE.value
            assert current_job["progress"] == 100.0
            assert current_job["output_path"] == str(expected_file)

    # Step 4: Verify file presence on disk
    assert expected_file.exists()
    assert expected_file.read_bytes() == b"dummy video data content"
