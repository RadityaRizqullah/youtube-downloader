from unittest.mock import patch
from youtube_downloader.extractor import extract_video_info


def test_extract_video_info_extracts_available_qualities():
    mock_info = {
        "title": "Sample Video",
        "uploader": "Sample Creator",
        "duration": 180,
        "thumbnail": "https://example.com/thumb.jpg",
        "formats": [
            {"vcodec": "none", "acodec": "mp4a.40.2"},  # audio only
            {"vcodec": "avc1.4d401e", "height": 360, "ext": "mp4"},
            {"vcodec": "avc1.4d401f", "height": 720, "ext": "mp4"},
            {"vcodec": "vp9", "height": 1080, "ext": "webm"},
            {"vcodec": "vp9", "height": 720, "ext": "webm"},
        ],
    }

    with patch("youtube_downloader.extractor.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl_cls.return_value.__enter__.return_value.extract_info.return_value = mock_info
        meta = extract_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert meta["title"] == "Sample Video"
        assert meta["uploader"] == "Sample Creator"
        assert meta["duration_s"] == 180
        assert meta["thumbnail"] == "https://example.com/thumb.jpg"
        assert "available_qualities" in meta
        assert meta["available_qualities"] == ["1080p", "720p", "360p"]


def test_extract_video_info_without_formats_defaults_empty():
    mock_info = {
        "title": "No Formats Video",
        "duration": 60,
    }
    with patch("youtube_downloader.extractor.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl_cls.return_value.__enter__.return_value.extract_info.return_value = mock_info
        meta = extract_video_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert meta["available_qualities"] == []
