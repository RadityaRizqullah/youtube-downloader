# YouTube Downloader

A modern, fast, and self-hosted web application for downloading YouTube videos and audio. Powered by a **FastAPI** backend with **yt-dlp** and a responsive **React + Vite + Tailwind CSS** frontend with real-time WebSocket progress tracking.

---

## Features

- **Single Video Downloads**: Fetch video metadata preview (title, channel, duration, thumbnail, available resolutions) before queuing.
- **Audio-Only Extraction**: Convert and download audio in MP3, M4A, or Opus formats with custom bitrates (up to 320 kbps).
- **Multiple Video Formats & Resolutions**: Supports MP4, WebM, and MKV from 360p up to 1080p and best available quality.
- **Batch Downloading**: Paste multiple URLs at once to automatically validate and queue them.
- **Playlist Downloads**: Extract full YouTube playlists, select or deselect specific videos, and bulk-download with one click.
- **Real-Time Progress**: Live download speed, progress bars, and stage updates (Pending, Downloading, Merging, Done) streamed via WebSockets.
- **Queue Management**: Pause, cancel, retry failed jobs, delete jobs, or clear completed items with configurable concurrency (1–10 parallel downloads).
- **Customizable Settings**: Set custom output directory, default audio/video formats, and filename templates (e.g., `%(title)s.%(ext)s`).
- **Self-Contained Serving**: FastAPI automatically serves the built React frontend in production for single-port deployment.

---

## Tech Stack

### Backend
- **Python 3.12+**
- **FastAPI** – High-performance asynchronous REST API and WebSockets
- **Uvicorn** – Lightning-fast ASGI web server
- **yt-dlp** – Reliable media extraction and download engine
- **SQLAlchemy & SQLite** – Lightweight local database for persistent queue and settings
- **uv** – Extremely fast Python package and project manager

### Frontend
- **React 19** & **TypeScript**
- **Vite** – Fast build tool and development server
- **Tailwind CSS v4** – Modern responsive styling
- **Lucide React** – Clean UI icons

### External Dependencies
- **FFmpeg** – Required for post-processing, merging separate video/audio streams, and extracting audio.

---

## Prerequisites

Ensure you have the following installed on your machine:

1. **Python 3.12 or newer**:
   - Verify: `python --version` (or `python3 --version`)
2. **Node.js 18+ and npm**:
   - Verify: `node -v` and `npm -v`
3. **uv** (Recommended Python package manager):
   - Install via official script:
     - **Windows (PowerShell)**: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`
     - **macOS / Linux**: `curl -LsSf https://astral.sh/uv/install.sh | sh`
   - *Note: You can also use standard `pip` and virtual environments if preferred.*
4. **FFmpeg**:
   - **Windows**: `winget install Gyan.FFmpeg` or `choco install ffmpeg`
   - **macOS**: `brew install ffmpeg`
   - **Linux (Ubuntu/Debian)**: `sudo apt update && sudo apt install ffmpeg`
   - Verify: `ffmpeg -version`

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/RadityaRizqullah/youtube-downloader.git
cd youtube-downloader
```

### 2. Set Up Backend Dependencies

#### Option A: Using `uv` (Recommended)
`uv` automatically creates a virtual environment and installs dependencies from `pyproject.toml` / `uv.lock`:
```bash
uv sync
```

#### Option B: Using standard `pip` & `venv`
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -e .
```

### 3. Set Up Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

---

## Environment Setup & Configuration

- **Database**: SQLite is used for persistent job queue history and user preferences. The application automatically initializes `youtube_downloader.db` in the repository root on first run. No manual migrations needed.
- **Download Destination**: Completed files default to `~/Downloads/youtube-downloader`. You can update this anytime in the **Settings** view in the web UI.
- **Environment Variables**: No additional configuration or `.env` file required for local execution.

---

## How to Run Locally

### Option 1: Development Mode (Hot Reload)

Run backend and frontend concurrently in two separate terminal windows:

#### Terminal 1 — Backend:
```bash
# With uv:
uv run uvicorn youtube_downloader.main:app --reload --port 8000

# Or with activated venv:
uvicorn youtube_downloader.main:app --reload --port 8000
```
- API root: `http://127.0.0.1:8000`
- Interactive Swagger docs: `http://127.0.0.1:8000/docs`

#### Terminal 2 — Frontend:
```bash
cd frontend
npm run dev
```
Open **`http://localhost:3000`** in your browser. The Vite development server automatically proxies `/api` and `/ws` to port 8000.

---

### Option 2: Production / Single-Port Mode

FastAPI serves the compiled frontend assets directly from port 8000:

1. **Build the frontend**:
   ```bash
   cd frontend
   npm run build
   cd ..
   ```
2. **Start the server**:
   ```bash
   uv run uvicorn youtube_downloader.main:app --port 8000
   ```
3. Open **`http://localhost:8000`** in your browser.

---

## Running Tests

Run test suites to ensure both backend and frontend components work properly:

### Backend Tests (pytest)
```bash
uv run pytest
```

### Frontend Tests (vitest)
```bash
cd frontend
npm test
```

---

## Project Structure

```
youtube-downloader/
├── frontend/                  # React + Vite frontend application
│   ├── src/                   # Components, utilities, and tests
│   │   ├── App.tsx            # Main application UI and navigation
│   │   ├── DownloadQueue.tsx  # Download queue component with real-time stats
│   │   └── utils.ts           # URL validators and formatting helpers
│   ├── package.json           # Frontend dependencies & scripts
│   └── vite.config.ts         # Vite build and proxy configuration
├── src/
│   └── youtube_downloader/    # FastAPI backend application
│       ├── database.py        # SQLite engine and session handling
│       ├── downloader.py      # yt-dlp worker execution and progress hook
│       ├── extractor.py       # Metadata extraction and FFmpeg check
│       ├── main.py            # FastAPI endpoints, WebSocket, and SPA mount
│       ├── models.py          # SQLAlchemy models (DownloadJob, Settings)
│       ├── queue.py           # In-memory async concurrency queue
│       ├── schemas.py         # Pydantic validation schemas
│       └── ws.py              # WebSocket connection manager
├── tests/                     # Backend test suite (pytest)
├── pyproject.toml             # Python project configuration & dependencies
├── uv.lock                    # Locked dependency versions
└── README.md                  # Project documentation
```

---

## License

This project is licensed under the [MIT License](LICENSE).
