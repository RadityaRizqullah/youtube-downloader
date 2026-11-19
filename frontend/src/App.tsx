import { useState, useEffect, useRef } from 'react'
import { isValidYouTubeUrl, formatDuration } from './utils'
import { AlertCircle, AlertTriangle, Download, Eye, Film, Loader2 } from 'lucide-react'
import { DownloadQueue, type DownloadJob } from './DownloadQueue'

interface VideoMetadata {
  url: string
  title: string
  uploader: string
  duration_s: number
  thumbnail: string
  available_qualities?: string[]
}

export default function App() {
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [isTouched, setIsTouched] = useState(false)
  const [isFetchingMeta, setIsFetchingMeta] = useState(false)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [extractError, setExtractError] = useState('')
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean | null>(null)

  // Quality & Format selections
  const [audioOnly, setAudioOnly] = useState(false)
  const [videoFormat, setVideoFormat] = useState('mp4')
  const [videoQuality, setVideoQuality] = useState('best')
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [audioBitrate, setAudioBitrate] = useState('best')

  const wsRef = useRef<WebSocket | null>(null)

  // Check backend health, FFmpeg & load queue on startup
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.ffmpeg === 'boolean') {
          setFfmpegInstalled(data.ffmpeg)
        }
      })
      .catch(() => {})

    fetch('/api/jobs')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setJobs(data)
        }
      })
      .catch(() => {})
  }, [])

  // Setup WebSocket connection for real-time progress updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/jobs`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data)
        setJobs((prev) =>
          prev.map((j) =>
            j.id === update.id
              ? {
                  ...j,
                  state: update.state,
                  progress: update.progress,
                  error: update.error,
                  output_path: update.output_path ?? j.output_path,
                }
              : j
          )
        )
      } catch (e) {
        console.error('Failed to parse WebSocket message', e)
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  const handleUrlChange = (value: string) => {
    setUrl(value)
    if (isTouched) {
      validateUrl(value)
    }
  }

  const validateUrl = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) {
      setUrlError('URL is required')
      return false
    }
    if (!isValidYouTubeUrl(trimmed)) {
      setUrlError('Please enter a valid YouTube video URL')
      return false
    }
    setUrlError('')
    return true
  }

  const handleBlur = () => {
    setIsTouched(true)
    validateUrl(url)
  }

  const fetchMetadata = async (targetUrl = url) => {
    setIsTouched(true)
    if (!validateUrl(targetUrl)) return

    setIsFetchingMeta(true)
    setExtractError('')
    setMetadata(null)

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(targetUrl.trim())}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to fetch video preview')
      }
      const data: VideoMetadata = await res.json()
      setMetadata(data)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error fetching metadata'
      setExtractError(message)
    } finally {
      setIsFetchingMeta(false)
    }
  }

  const handleDownload = async () => {
    if (!metadata) return
    setIsSubmitting(true)
    const chosenFormat = audioOnly ? audioFormat : videoFormat
    const chosenQuality = audioOnly ? audioBitrate : videoQuality
    try {
      const payload = {
        url: metadata.url,
        title: metadata.title,
        uploader: metadata.uploader,
        duration_s: metadata.duration_s,
        thumbnail: metadata.thumbnail,
        format: chosenFormat,
        quality: chosenQuality,
        audio_only: audioOnly,
      }
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to initiate download')
      }
      const job: DownloadJob = await res.json()
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start download'
      setExtractError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
      if (res.ok) {
        const updated: DownloadJob = await res.json()
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)))
      }
    } catch (e) {
      console.error('Failed to cancel job', e)
    }
  }

  const handleCancelAll = async () => {
    try {
      const res = await fetch('/api/jobs/cancel-all', { method: 'POST' })
      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) =>
            ['PENDING', 'DOWNLOADING', 'MERGING', 'FETCHING'].includes(j.state)
              ? { ...j, state: 'CANCELLED', error: 'Cancelled by user' }
              : j
          )
        )
      }
    } catch (e) {
      console.error('Failed to cancel all jobs', e)
    }
  }

  const handleRetry = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' })
      if (res.ok) {
        const retried: DownloadJob = await res.json()
        setJobs((prev) => prev.map((j) => (j.id === jobId ? retried : j)))
      }
    } catch (e) {
      console.error('Failed to retry job', e)
    }
  }

  const handleDelete = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== jobId))
      }
    } catch (e) {
      console.error('Failed to delete job', e)
    }
  }

  const handleClearCompleted = async () => {
    try {
      const res = await fetch('/api/jobs/clear-completed', { method: 'POST' })
      if (res.ok) {
        setJobs((prev) =>
          prev.filter((j) => !['DONE', 'FAILED', 'CANCELLED'].includes(j.state))
        )
      }
    } catch (e) {
      console.error('Failed to clear completed jobs', e)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        {/* Header */}
        <header className="flex items-center space-x-3 border-b border-slate-800 pb-4">
          <Film className="w-8 h-8 text-rose-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">YouTube Downloader</h1>
            <p className="text-xs text-slate-400">Single Video Preview & Download</p>
          </div>
        </header>

        {/* Legal notice */}
        <div className="text-xs bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 text-slate-400 leading-relaxed">
          <strong>Notice:</strong> Only download content you own or are authorized to download, in
          compliance with YouTube's Terms of Service and applicable copyright law.
        </div>

        {/* FFmpeg Warning Banner */}
        {ffmpegInstalled === false && (
          <div className="flex items-center space-x-2 bg-amber-950/50 border border-amber-600/40 rounded-lg p-3 text-amber-200 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
            <span>
              FFmpeg was not detected on system PATH. High-quality video and audio merging will fail.
            </span>
          </div>
        )}

        {/* URL Input Form */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-3">
          <label htmlFor="video-url" className="block text-sm font-medium text-slate-300">
            YouTube Video URL
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="video-url"
                type="text"
                placeholder="Paste YouTube video URL here..."
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                onBlur={handleBlur}
                className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition ${
                  urlError
                    ? 'border-rose-500 focus:ring-rose-500/50'
                    : 'border-slate-700 focus:ring-rose-500/50'
                }`}
              />
            </div>
            <button
              onClick={() => fetchMetadata()}
              disabled={isFetchingMeta || !url.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-650 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-sm font-medium transition cursor-pointer"
            >
              {isFetchingMeta ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              Preview
            </button>
          </div>

          {urlError && (
            <p className="text-xs text-rose-400 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {urlError}
            </p>
          )}

          {extractError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300">
              {extractError}
            </div>
          )}
        </div>

        {/* Video Preview Card */}
        {metadata && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg animate-in fade-in duration-200">
            <div className="sm:flex">
              <div className="sm:w-56 shrink-0 relative bg-slate-950 flex items-center justify-center">
                {metadata.thumbnail ? (
                  <img
                    src={metadata.thumbnail}
                    alt="Video thumbnail"
                    className="w-full h-36 object-cover"
                  />
                ) : (
                  <Film className="w-12 h-12 text-slate-700" />
                )}
                <span className="absolute bottom-2 right-2 bg-black/80 text-white font-mono text-xs px-1.5 py-0.5 rounded">
                  {formatDuration(metadata.duration_s)}
                </span>
              </div>
              <div className="p-4 flex flex-col justify-between flex-1 space-y-3">
                <div>
                  <h2 className="font-semibold text-slate-100 line-clamp-2 text-base leading-snug">
                    {metadata.title}
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">{metadata.uploader}</p>
                </div>

                {/* Video / Audio toggle & format options */}
                <div className="space-y-2 pt-1 border-t border-slate-700/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Download Type:</span>
                    <div className="flex rounded-lg bg-slate-900/60 p-0.5 border border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setAudioOnly(false)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                          !audioOnly
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Video
                      </button>
                      <button
                        type="button"
                        onClick={() => setAudioOnly(true)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                          audioOnly
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Audio Only
                      </button>
                    </div>
                  </div>

                  {!audioOnly ? (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label htmlFor="video-format" className="block text-xs font-medium text-slate-300 mb-1">
                          Format
                        </label>
                        <select
                          id="video-format"
                          value={videoFormat}
                          onChange={(e) => setVideoFormat(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="mp4">MP4</option>
                          <option value="webm">WebM</option>
                          <option value="mkv">MKV</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="video-quality" className="block text-xs font-medium text-slate-300 mb-1">
                          Quality
                        </label>
                        <select
                          id="video-quality"
                          value={videoQuality}
                          onChange={(e) => setVideoQuality(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="best">Best Quality</option>
                          {(['1080p', '720p', '480p', '360p'] as const).map((q) => {
                            const isAvailable =
                              !metadata.available_qualities ||
                              metadata.available_qualities.length === 0 ||
                              metadata.available_qualities.includes(q)
                            return (
                              <option key={q} value={q} disabled={!isAvailable}>
                                {q} {!isAvailable ? '(unavailable)' : ''}
                              </option>
                            )
                          })}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label htmlFor="audio-format" className="block text-xs font-medium text-slate-300 mb-1">
                          Format
                        </label>
                        <select
                          id="audio-format"
                          value={audioFormat}
                          onChange={(e) => setAudioFormat(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="mp3">MP3</option>
                          <option value="m4a">M4A</option>
                          <option value="opus">Opus</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="audio-bitrate" className="block text-xs font-medium text-slate-300 mb-1">
                          Bitrate
                        </label>
                        <select
                          id="audio-bitrate"
                          value={audioBitrate}
                          onChange={(e) => setAudioBitrate(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="best">Best Quality</option>
                          <option value="320k">320 kbps</option>
                          <option value="192k">192 kbps</option>
                          <option value="128k">128 kbps</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={handleDownload}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 rounded-lg font-medium text-sm text-white transition shadow-md cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Download Queue View */}
        <DownloadQueue
          jobs={jobs}
          onCancel={handleCancel}
          onCancelAll={handleCancelAll}
          onRetry={handleRetry}
          onDelete={handleDelete}
          onClearCompleted={handleClearCompleted}
        />
      </div>
    </div>
  )
}
