# Glossary

## DownloadJob

A single unit of work: download one video or ClipSegment at one quality/format combination to the configured output folder. Every DownloadJob is independently trackable, cancellable, and retryable.

**Avoid:** "task", "item", "download" (too generic).

---

## ClipSegment

A bounded time interval defined by start and end timestamps (in seconds) identifying a portion of a video to download instead of the full video.

**Avoid:** "trim", "snip", "cut", "crop".

---

## Batch Download

A mode where the user manually pastes a list of individual YouTube video URLs. Each URL expands into one DownloadJob. The batch is an import mechanism only — it has no persistent identity after expansion.

**Avoid:** "bulk download" (ambiguous — see Playlist Download).

---

## Playlist Download

A mode where the user supplies a YouTube playlist URL. The app fetches the playlist manifest, presents all videos for preview and selection, then expands the confirmed selection into N individual DownloadJobs.

**Avoid:** "bulk download" (ambiguous — see Batch Download).

---

## VideoMetadata

The read-only information fetched from YouTube before a DownloadJob is queued: title, uploader, duration, thumbnail URL, and available format/quality options. Fetched via yt-dlp `extract_info`. Not persisted beyond the session preview.

---

## FormatSelection

The user's chosen combination of container format and quality tier for a DownloadJob.

- **Video FormatSelection**: format ∈ {mp4, webm, mkv} × quality ∈ {best, 1080p, 720p, 480p, 360p}
- **Audio FormatSelection**: format ∈ {mp3, m4a, opus} × quality ∈ {best, 320k, 192k, 128k}

---

## DownloadQueue

The ordered, in-memory list of all DownloadJobs. At most N jobs run concurrently (N = max concurrency setting, default 3). Remaining jobs wait in PENDING state.

---

## JobState

The lifecycle state of a DownloadJob:

- `PENDING` — queued, not yet started
- `FETCHING` — fetching VideoMetadata (pre-queue preview step)
- `DOWNLOADING` — yt-dlp subprocess active, progress streaming
- `MERGING` — FFmpeg merging video+audio streams (post-download step)
- `DONE` — file written to output folder successfully
- `FAILED` — terminal error; error message stored, retry available
- `CANCELLED` — user-cancelled before or during download

---

## OutputFolder

The filesystem path where completed DownloadJob files are written. User-configured in Settings. Defaults to `~/Downloads/youtube-downloader`.

---

## Settings

Persistent app configuration stored in SQLite. Four fields: OutputFolder, max concurrency, filename template, default FormatSelection.

---

## FFmpeg

External binary required for merging separate video and audio streams (necessary for 1080p+ quality). Must be installed by the user separately. App checks for FFmpeg on startup and surfaces a warning if absent.
