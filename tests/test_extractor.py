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


def test_is_playlist_url_detection():
    from youtube_downloader.extractor import is_playlist_url

    assert is_playlist_url("https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4") is True
    assert is_playlist_url("https://youtube.com/playlist?list=PL12345") is True
    assert is_playlist_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is False
    assert is_playlist_url("https://youtu.be/dQw4w9WgXcQ") is False


def test_extract_playlist_info_parses_manifest_flat():
    from youtube_downloader.extractor import extract_playlist_info

    mock_manifest = {
        "_type": "playlist",
        "title": "Lex Fridman Podcast",
        "uploader": "Lex Fridman",
        "entries": [
            {
                "id": "vid1",
                "title": "Episode 1",
                "uploader": "Lex Fridman",
                "duration": 3600,
                "url": "https://www.youtube.com/watch?v=vid1",
                "thumbnails": [{"url": "https://example.com/thumb1.jpg"}],
            },
            {
                "id": "vid2",
                "title": "Episode 2",
                "uploader": "Lex Fridman",
                "duration": 1800,
                "url": "https://www.youtube.com/watch?v=vid2",
                "thumbnails": [{"url": "https://example.com/thumb2.jpg"}],
            },
        ],
    }

    with patch("youtube_downloader.extractor.yt_dlp.YoutubeDL") as mock_ydl_cls:
        ydl_instance = mock_ydl_cls.return_value.__enter__.return_value
        ydl_instance.extract_info.return_value = mock_manifest

        result = extract_playlist_info("https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4")

        # Verify extract_flat=True passed to yt_dlp for performance
        opts = mock_ydl_cls.call_args[0][0]
        assert opts.get("extract_flat") is True

        assert result["title"] == "Lex Fridman Podcast"
        assert result["uploader"] == "Lex Fridman"
        assert result["video_count"] == 2
        assert len(result["videos"]) == 2
        assert result["videos"][0]["url"] == "https://www.youtube.com/watch?v=vid1"
        assert result["videos"][0]["title"] == "Episode 1"
        assert result["videos"][0]["duration_s"] == 3600
        assert result["videos"][0]["thumbnail"] == "https://example.com/thumb1.jpg"

