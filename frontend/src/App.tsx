import { useState, useEffect, useRef } from 'react'
import { isValidYouTubeUrl, formatDuration } from './utils'
import { AlertCircle, AlertTriangle, CheckCircle2, Download, Eye, Film, Loader2 } from 'lucide-react'

interface VideoMetadata {
  url: string
  title: string
  uploader: string
  duration_s: number
  thumbnail: string
  available_qualities?: string[]
}

interface DownloadJob {
  id: string
  url: string
  title: string | null
  uploader: string | null
  duration_s: number | null
  thumbnail: string | null
  format: string
  quality: string
  audio_only: boolean
  state: string
  progress: number
  error: string | null
  output_path: string | null
}

export default function App() {
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [isTouched, setIsTouched] = useState(false)
  const [isFetchingMeta, setIsFetchingMeta] = useState(false)
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null)
  const [extractError, setExtractError] = useState('')
  const [activeJob, setActiveJob] = useState<DownloadJob | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [ffmpegInstalled, setFfmpegInstalled] = useState<boolean | null>(null)

  // Quality & Format selections
  const [audioOnly, setAudioOnly] = useState(false)
  const [videoFormat, setVideoFormat] = useState('mp4')
  const [videoQuality, setVideoQuality] = useState('best')
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [audioBitrate, setAudioBitrate] = useState('best')

  const wsRef = useRef<WebSocket | null>(null)

  // Check backend health & FFmpeg on startup
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.ffmpeg === 'boolean') {
          setFfmpegInstalled(data.ffmpeg)
        }
      })
      .catch(() => {
        // Backend offline or during mock tests
      })
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
        setActiveJob((prev) => {
          if (!prev || prev.id !== update.id) return prev
          return {
            ...prev,
            state: update.state,
            progress: update.progress,
            error: update.error,
            output_path: update.output_path ?? prev.output_path,
          }
        })
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
      setActiveJob(job)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start download'
      setActiveJob({
        id: 'err',
        url: metadata.url,
        title: metadata.title,
        uploader: metadata.uploader,
        duration_s: metadata.duration_s,
        thumbnail: metadata.thumbnail,
        format: chosenFormat,
        quality: chosenQuality,
        audio_only: audioOnly,
        state: 'FAILED',
        progress: 0,
        error: message,
        output_path: null,
      })
    } finally {
      setIsSubmitting(false)
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
                    disabled={isSubmitting || activeJob?.state === 'DOWNLOADING' || activeJob?.state === 'MERGING'}
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

        {/* Active Download Job Status */}
        {activeJob && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Download Status
                </span>
                <p className="text-sm font-medium text-slate-200 truncate max-w-md">
                  {activeJob.title || activeJob.url}
                </p>
              </div>
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                  activeJob.state === 'DONE'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : activeJob.state === 'FAILED'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : activeJob.state === 'MERGING'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}
              >
                {activeJob.state}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Progress</span>
                <span className="font-mono">{activeJob.progress.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    activeJob.state === 'DONE'
                      ? 'bg-emerald-500'
                      : activeJob.state === 'FAILED'
                      ? 'bg-rose-500'
                      : activeJob.state === 'MERGING'
                      ? 'bg-purple-500'
                      : 'bg-rose-600'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, activeJob.progress))}%` }}
                />
              </div>
            </div>

            {/* Merging message */}
            {activeJob.state === 'MERGING' && (
              <p className="text-xs text-purple-300 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing audio/video streams with FFmpeg...
              </p>
            )}

            {/* Completion message */}
            {activeJob.state === 'DONE' && (
              <div className="flex items-start gap-2 p-3 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                <div>
                  <p className="font-medium">Download complete!</p>
                  {activeJob.output_path && (
                    <p className="text-slate-400 font-mono mt-0.5 break-all">
                      Saved: {activeJob.output_path}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Error message */}
            {activeJob.state === 'FAILED' && (
              <div className="flex items-start gap-2 p-3 bg-rose-950/40 border border-rose-800/40 rounded-lg text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <div>
                  <p className="font-medium">Download failed</p>
                  <p className="text-rose-200/80 mt-0.5 break-all">{activeJob.error}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
