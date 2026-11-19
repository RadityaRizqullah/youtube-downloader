import { useState, useEffect, useRef } from 'react'
import { isValidYouTubeUrl, isPlaylistUrl, formatDuration, validateBatchUrls } from './utils'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Film,
  Loader2,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import { DownloadQueue, type DownloadJob } from './DownloadQueue'

interface VideoMetadata {
  url: string
  title: string
  uploader: string
  duration_s: number
  thumbnail: string
  available_qualities?: string[]
}

interface PlaylistMetadata {
  url: string
  title: string
  uploader: string
  video_count: number
  videos: VideoMetadata[]
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
  const [ffmpegDismissed, setFfmpegDismissed] = useState(false)

  // Quality & Format selections
  const [audioOnly, setAudioOnly] = useState(false)
  const [videoFormat, setVideoFormat] = useState('mp4')
  const [videoQuality, setVideoQuality] = useState('best')
  const [audioFormat, setAudioFormat] = useState('mp3')
  const [audioBitrate, setAudioBitrate] = useState('best')

  // Navigation mode
  const [activeTab, setActiveTab] = useState<'single' | 'batch' | 'playlist' | 'settings'>('single')

  // Settings state
  const [outputFolder, setOutputFolder] = useState('~/Downloads/youtube-downloader')
  const [maxConcurrency, setMaxConcurrency] = useState(3)
  const [filenameTemplate, setFilenameTemplate] = useState('%(title)s.%(ext)s')
  const [settingsVideoFormat, setSettingsVideoFormat] = useState('mp4')
  const [settingsVideoQuality, setSettingsVideoQuality] = useState('best')
  const [settingsAudioFormat, setSettingsAudioFormat] = useState('mp3')
  const [settingsAudioBitrate, setSettingsAudioBitrate] = useState('best')
  const [isSettingsSaving, setIsSettingsSaving] = useState(false)
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState('')
  const [settingsErrorMsg, setSettingsErrorMsg] = useState('')

  // Batch Download state
  const [batchInput, setBatchInput] = useState('')
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false)
  const [batchSummary, setBatchSummary] = useState('')
  const [batchAudioOnly, setBatchAudioOnly] = useState(false)
  const [batchVideoFormat, setBatchVideoFormat] = useState('mp4')
  const [batchVideoQuality, setBatchVideoQuality] = useState('best')
  const [batchAudioFormat, setBatchAudioFormat] = useState('mp3')
  const [batchAudioBitrate, setBatchAudioBitrate] = useState('best')

  // Playlist Download state
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [playlistUrlError, setPlaylistUrlError] = useState('')
  const [isPlaylistTouched, setIsPlaylistTouched] = useState(false)
  const [isFetchingPlaylist, setIsFetchingPlaylist] = useState(false)
  const [playlistMetadata, setPlaylistMetadata] = useState<PlaylistMetadata | null>(null)
  const [playlistExtractError, setPlaylistExtractError] = useState('')
  const [selectedVideoIndices, setSelectedVideoIndices] = useState<Set<number>>(new Set())
  const [isPlaylistSubmitting, setIsPlaylistSubmitting] = useState(false)
  const [playlistSummary, setPlaylistSummary] = useState('')
  const [playlistAudioOnly, setPlaylistAudioOnly] = useState(false)
  const [playlistVideoFormat, setPlaylistVideoFormat] = useState('mp4')
  const [playlistVideoQuality, setPlaylistVideoQuality] = useState('best')
  const [playlistAudioFormat, setPlaylistAudioFormat] = useState('mp3')
  const [playlistAudioBitrate, setPlaylistAudioBitrate] = useState('best')

  const batchValidation = validateBatchUrls(batchInput)

  const wsRef = useRef<WebSocket | null>(null)

  // Check backend health, FFmpeg, settings & load queue on startup
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (typeof data.ffmpeg === 'boolean') {
          setFfmpegInstalled(data.ffmpeg)
        }
      })
      .catch(() => {})

    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data === 'object') {
          if (data.output_folder) setOutputFolder(data.output_folder)
          if (typeof data.max_concurrency === 'number') setMaxConcurrency(data.max_concurrency)
          if (data.filename_template) setFilenameTemplate(data.filename_template)
          if (data.default_format) {
            setSettingsVideoFormat(data.default_format)
            setVideoFormat(data.default_format)
            setBatchVideoFormat(data.default_format)
            setPlaylistVideoFormat(data.default_format)
          }
          if (data.default_quality) {
            setSettingsVideoQuality(data.default_quality)
            setVideoQuality(data.default_quality)
            setBatchVideoQuality(data.default_quality)
            setPlaylistVideoQuality(data.default_quality)
          }
          if (data.default_audio_format) {
            setSettingsAudioFormat(data.default_audio_format)
            setAudioFormat(data.default_audio_format)
            setBatchAudioFormat(data.default_audio_format)
            setPlaylistAudioFormat(data.default_audio_format)
          }
          if (data.default_audio_quality) {
            setSettingsAudioBitrate(data.default_audio_quality)
            setAudioBitrate(data.default_audio_quality)
            setBatchAudioBitrate(data.default_audio_quality)
            setPlaylistAudioBitrate(data.default_audio_quality)
          }
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
    if (isPlaylistUrl(value)) {
      setActiveTab('playlist')
      setPlaylistUrl(value)
      fetchPlaylistMetadata(value)
      return
    }
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

  // ponytail: client submits all non-empty lines; upgrade to client-side pre-filtering if requested
  const handleQueueBatch = async () => {
    if (batchValidation.entries.length === 0) return
    setIsBatchSubmitting(true)
    setBatchSummary('')

    const chosenFormat = batchAudioOnly ? batchAudioFormat : batchVideoFormat
    const chosenQuality = batchAudioOnly ? batchAudioBitrate : batchVideoQuality

    try {
      const urls = batchValidation.entries.map((e) => e.url)

      const res = await fetch('/api/jobs/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          format: chosenFormat,
          quality: chosenQuality,
          audio_only: batchAudioOnly,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to queue batch download')
      }

      const data = await res.json()
      if (Array.isArray(data.queued)) {
        setJobs((prev) => [
          ...data.queued,
          ...prev.filter((j) => !data.queued.some((q: DownloadJob) => q.id === j.id)),
        ])
      }

      const queuedCount = data.total_queued ?? data.queued.length
      const failedCount = data.total_failed ?? data.failed.length

      if (failedCount > 0) {
        const remainingFailed = data.failed.map((f: { url: string }) => f.url).join('\n')
        setBatchInput(remainingFailed)
        setBatchSummary(
          `Queued ${queuedCount} job${queuedCount === 1 ? '' : 's'} (${failedCount} invalid URL${failedCount === 1 ? '' : 's'} skipped). Monitored in queue below.`
        )
      } else {
        setBatchInput('')
        setBatchSummary(
          `Queued ${queuedCount} job${queuedCount === 1 ? '' : 's'}. Monitored in queue below.`
        )
      }

      const el = document.getElementById('download-queue')
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error queueing batch'
      setBatchSummary(`Error: ${message}`)
    } finally {
      setIsBatchSubmitting(false)
    }
  }

  const handlePlaylistUrlChange = (value: string) => {
    setPlaylistUrl(value)
    if (isPlaylistUrl(value)) {
      fetchPlaylistMetadata(value)
      return
    }
    if (isPlaylistTouched) {
      validatePlaylistUrl(value)
    }
  }

  const validatePlaylistUrl = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) {
      setPlaylistUrlError('Playlist URL is required')
      return false
    }
    if (!isValidYouTubeUrl(trimmed)) {
      setPlaylistUrlError('Please enter a valid YouTube playlist URL')
      return false
    }
    setPlaylistUrlError('')
    return true
  }

  const handlePlaylistBlur = () => {
    setIsPlaylistTouched(true)
    validatePlaylistUrl(playlistUrl)
  }

  const fetchPlaylistMetadata = async (targetUrl = playlistUrl) => {
    setIsPlaylistTouched(true)
    if (!validatePlaylistUrl(targetUrl)) return

    setIsFetchingPlaylist(true)
    setPlaylistExtractError('')
    setPlaylistMetadata(null)

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(targetUrl.trim())}&playlist=true`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to fetch playlist preview')
      }
      const data: PlaylistMetadata = await res.json()
      setPlaylistMetadata(data)
      setSelectedVideoIndices(new Set((data.videos || []).map((_, i) => i)))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error fetching playlist metadata'
      setPlaylistExtractError(message)
    } finally {
      setIsFetchingPlaylist(false)
    }
  }

  const toggleVideoSelection = (index: number) => {
    setSelectedVideoIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // ponytail: client-side selection dispatch; upgrade to range selection (e.g. 1-10) if requested
  const handleDownloadPlaylist = async () => {
    if (!playlistMetadata || selectedVideoIndices.size === 0) return
    setIsPlaylistSubmitting(true)
    setPlaylistSummary('')

    const chosenFormat = playlistAudioOnly ? playlistAudioFormat : playlistVideoFormat
    const chosenQuality = playlistAudioOnly ? playlistAudioBitrate : playlistVideoQuality

    const selectedVideos = playlistMetadata.videos
      .filter((_, idx) => selectedVideoIndices.has(idx))
      .map((v) => ({
        url: v.url,
        title: v.title,
        uploader: v.uploader,
        duration_s: v.duration_s,
        thumbnail: v.thumbnail,
      }))

    try {
      const res = await fetch('/api/jobs/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: selectedVideos,
          format: chosenFormat,
          quality: chosenQuality,
          audio_only: playlistAudioOnly,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Failed to queue playlist download')
      }

      const data = await res.json()
      if (Array.isArray(data.queued)) {
        setJobs((prev) => [
          ...data.queued,
          ...prev.filter((j) => !data.queued.some((q: DownloadJob) => q.id === j.id)),
        ])
      }

      const queuedCount = data.total_queued ?? data.queued.length
      setPlaylistSummary(
        `Queued ${queuedCount} job${queuedCount === 1 ? '' : 's'}. Monitored in queue below.`
      )

      const el = document.getElementById('download-queue')
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error queueing playlist'
      setPlaylistSummary(`Error: ${message}`)
    } finally {
      setIsPlaylistSubmitting(false)
    }
  }

  const handleSaveSettings = async () => {
    setIsSettingsSaving(true)
    setSettingsSuccessMsg('')
    setSettingsErrorMsg('')

    try {
      const payload = {
        output_folder: outputFolder,
        max_concurrency: Number(maxConcurrency),
        filename_template: filenameTemplate,
        default_format: settingsVideoFormat,
        default_quality: settingsVideoQuality,
        default_audio_format: settingsAudioFormat,
        default_audio_quality: settingsAudioBitrate,
      }

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        let msg = 'Failed to update settings'
        if (typeof err.detail === 'string') {
          msg = err.detail
        } else if (Array.isArray(err.detail) && err.detail.length > 0) {
          msg = err.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
        }
        throw new Error(msg)
      }

      const data = await res.json()
      setOutputFolder(data.output_folder)
      setMaxConcurrency(data.max_concurrency)
      setFilenameTemplate(data.filename_template)
      setSettingsVideoFormat(data.default_format)
      setSettingsVideoQuality(data.default_quality)
      setSettingsAudioFormat(data.default_audio_format)
      setSettingsAudioBitrate(data.default_audio_quality)

      setVideoFormat(data.default_format)
      setVideoQuality(data.default_quality)
      setBatchVideoFormat(data.default_format)
      setBatchVideoQuality(data.default_quality)
      setPlaylistVideoFormat(data.default_format)
      setPlaylistVideoQuality(data.default_quality)

      setAudioFormat(data.default_audio_format)
      setAudioBitrate(data.default_audio_quality)
      setBatchAudioFormat(data.default_audio_format)
      setBatchAudioBitrate(data.default_audio_quality)
      setPlaylistAudioFormat(data.default_audio_format)
      setPlaylistAudioBitrate(data.default_audio_quality)

      setSettingsSuccessMsg('Settings saved successfully.')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error updating settings'
      setSettingsErrorMsg(message)
    } finally {
      setIsSettingsSaving(false)
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
            <p className="text-xs text-slate-400">
              {activeTab === 'single'
                ? 'Single Video Preview & Download'
                : activeTab === 'batch'
                ? 'Batch URL Input & Queueing'
                : activeTab === 'playlist'
                ? 'Playlist Preview & Selective Download'
                : 'Application Preferences & Defaults'}
            </p>
          </div>
        </header>

        {/* Legal notice */}
        <div className="text-xs bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 text-slate-400 leading-relaxed">
          <strong>Notice:</strong> Only download content you own or are authorized to download, in
          compliance with YouTube's Terms of Service and applicable copyright law.
        </div>

        {/* FFmpeg Warning Banner */}
        {ffmpegInstalled === false && !ffmpegDismissed && (
          <div className="flex items-center justify-between bg-amber-950/50 border border-amber-600/40 rounded-lg p-3 text-amber-200 text-sm">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
              <span>
                FFmpeg was not detected on system PATH. High-quality video and audio merging will fail.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setFfmpegDismissed(true)}
              aria-label="Dismiss warning"
              className="text-amber-400 hover:text-amber-200 px-2 py-1 rounded hover:bg-amber-900/40 transition cursor-pointer text-xs flex items-center gap-1 shrink-0 ml-2"
            >
              <X className="w-3.5 h-3.5" />
              <span>Dismiss</span>
            </button>
          </div>
        )}

        {/* Mode Navigation Tabs */}
        <div className="flex border-b border-slate-800 space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('single')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'single'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Single Video
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('batch')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'batch'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Batch Download
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('playlist')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'playlist'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Playlist Download
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'settings'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            Settings
          </button>
        </div>

        {/* Single Video Mode */}
        {activeTab === 'single' && (
          <>
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
          </>
        )}

        {/* Batch Download Mode */}
        {activeTab === 'batch' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4 animate-in fade-in duration-200">
            <div>
              <label htmlFor="batch-urls" className="block text-sm font-medium text-slate-300 mb-1">
                YouTube Video URLs (one per line)
              </label>
              <textarea
                id="batch-urls"
                rows={5}
                placeholder="Paste YouTube URLs (one per line)..."
                value={batchInput}
                onChange={(e) => {
                  setBatchInput(e.target.value)
                  setBatchSummary('')
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 font-mono resize-y"
              />
            </div>

            {/* Inline URL validation feedback */}
            {batchValidation.invalidEntries.length > 0 && (
              <div className="space-y-1 p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300">
                <div className="font-semibold text-rose-200 flex items-center gap-1.5 mb-1">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Invalid URLs detected:</span>
                </div>
                {batchValidation.invalidEntries.map((item) => (
                  <div key={item.lineNumber} className="pl-5 text-slate-300">
                    <span className="font-mono text-rose-400">Line {item.lineNumber}:</span> {item.error} &mdash;{' '}
                    <span className="font-mono text-slate-400 break-all">{item.url}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Unified Format Selection for Batch */}
            <div className="space-y-2 pt-2 border-t border-slate-700/60">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Batch Download Type:</span>
                <div className="flex rounded-lg bg-slate-900/60 p-0.5 border border-slate-700/60">
                  <button
                    type="button"
                    onClick={() => setBatchAudioOnly(false)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      !batchAudioOnly
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    onClick={() => setBatchAudioOnly(true)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                      batchAudioOnly
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Audio Only
                  </button>
                </div>
              </div>

              {!batchAudioOnly ? (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="batch-video-format" className="block text-xs font-medium text-slate-300 mb-1">
                      Format
                    </label>
                    <select
                      id="batch-video-format"
                      value={batchVideoFormat}
                      onChange={(e) => setBatchVideoFormat(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    >
                      <option value="mp4">MP4</option>
                      <option value="webm">WebM</option>
                      <option value="mkv">MKV</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="batch-video-quality" className="block text-xs font-medium text-slate-300 mb-1">
                      Quality
                    </label>
                    <select
                      id="batch-video-quality"
                      value={batchVideoQuality}
                      onChange={(e) => setBatchVideoQuality(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    >
                      <option value="best">Best Quality</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                      <option value="360p">360p</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="batch-audio-format" className="block text-xs font-medium text-slate-300 mb-1">
                      Format
                    </label>
                    <select
                      id="batch-audio-format"
                      value={batchAudioFormat}
                      onChange={(e) => setBatchAudioFormat(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                    >
                      <option value="mp3">MP3</option>
                      <option value="m4a">M4A</option>
                      <option value="opus">Opus</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="batch-audio-bitrate" className="block text-xs font-medium text-slate-300 mb-1">
                      Bitrate
                    </label>
                    <select
                      id="batch-audio-bitrate"
                      value={batchAudioBitrate}
                      onChange={(e) => setBatchAudioBitrate(e.target.value)}
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

            {/* Batch Submission Feedback Summary */}
            {batchSummary && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-xs text-emerald-300">
                {batchSummary}
              </div>
            )}

            <div className="pt-2 flex justify-between items-center">
              <span className="text-xs text-slate-400">
                {batchValidation.validUrls.length} valid URL
                {batchValidation.validUrls.length === 1 ? '' : 's'} ready
              </span>
              <button
                onClick={handleQueueBatch}
                disabled={isBatchSubmitting || batchValidation.entries.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg font-medium text-sm text-white transition shadow-md cursor-pointer"
              >
                {isBatchSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Queue Batch
              </button>
            </div>
          </div>
        )}

        {/* Playlist Download Mode */}
        {activeTab === 'playlist' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Playlist URL Input Form */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-3">
              <label htmlFor="playlist-url" className="block text-sm font-medium text-slate-300">
                YouTube Playlist URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="playlist-url"
                    type="text"
                    placeholder="Paste YouTube playlist URL here..."
                    value={playlistUrl}
                    onChange={(e) => handlePlaylistUrlChange(e.target.value)}
                    onBlur={handlePlaylistBlur}
                    className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 transition ${
                      playlistUrlError
                        ? 'border-rose-500 focus:ring-rose-500/50'
                        : 'border-slate-700 focus:ring-rose-500/50'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => fetchPlaylistMetadata()}
                  disabled={isFetchingPlaylist || !playlistUrl.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 active:bg-slate-650 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-sm font-medium transition cursor-pointer"
                >
                  {isFetchingPlaylist ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  Preview Playlist
                </button>
              </div>

              {playlistUrlError && (
                <p className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {playlistUrlError}
                </p>
              )}

              {playlistExtractError && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300">
                  {playlistExtractError}
                </div>
              )}
            </div>

            {/* Playlist Preview & Selection Card */}
            {playlistMetadata && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg p-5 space-y-4">
                {/* Playlist Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-700/60 gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100 leading-snug">
                      {playlistMetadata.title}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">{playlistMetadata.uploader}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-slate-900 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-full font-mono">
                      {playlistMetadata.video_count} videos
                    </span>
                  </div>
                </div>

                {/* Selection Controls */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-400">
                    {selectedVideoIndices.size} of {playlistMetadata.videos.length} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedVideoIndices(new Set(playlistMetadata.videos.map((_, i) => i)))
                      }
                      className="text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded hover:bg-slate-700/50 transition cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedVideoIndices(new Set())}
                      className="text-xs text-slate-400 hover:text-slate-200 font-medium px-2 py-1 rounded hover:bg-slate-700/50 transition cursor-pointer"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                {/* Interactive Checklist (scrollable container for performance on large playlists) */}
                <div className="max-h-96 overflow-y-auto space-y-2 pr-1 border border-slate-700/50 rounded-lg p-2 bg-slate-950/40">
                  {playlistMetadata.videos.map((video, index) => {
                    const isChecked = selectedVideoIndices.has(index)
                    return (
                      <label
                        key={video.url + index}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition select-none ${
                          isChecked
                            ? 'bg-slate-800/80 border border-slate-700/80'
                            : 'hover:bg-slate-900/60 border border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleVideoSelection(index)}
                          className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 bg-slate-900 border-slate-700 cursor-pointer"
                        />
                        <span className="text-xs font-mono text-slate-500 w-6 text-right shrink-0">
                          #{index + 1}
                        </span>
                        <div className="w-16 h-10 shrink-0 bg-slate-900 rounded overflow-hidden flex items-center justify-center">
                          {video.thumbnail ? (
                            <img
                              src={video.thumbnail}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Film className="w-5 h-5 text-slate-700" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate" title={video.title}>
                            {video.title}
                          </p>
                          <p className="text-[11px] text-slate-400">{video.uploader}</p>
                        </div>
                        <span className="text-xs font-mono text-slate-400 shrink-0">
                          {formatDuration(video.duration_s)}
                        </span>
                      </label>
                    )
                  })}
                </div>

                {/* Unified Format Selection for Playlist */}
                <div className="space-y-2 pt-2 border-t border-slate-700/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Download Type:</span>
                    <div className="flex rounded-lg bg-slate-900/60 p-0.5 border border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setPlaylistAudioOnly(false)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                          !playlistAudioOnly
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Video
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlaylistAudioOnly(true)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition cursor-pointer ${
                          playlistAudioOnly
                            ? 'bg-rose-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Audio Only
                      </button>
                    </div>
                  </div>

                  {!playlistAudioOnly ? (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label
                          htmlFor="playlist-video-format"
                          className="block text-xs font-medium text-slate-300 mb-1"
                        >
                          Format
                        </label>
                        <select
                          id="playlist-video-format"
                          value={playlistVideoFormat}
                          onChange={(e) => setPlaylistVideoFormat(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="mp4">MP4</option>
                          <option value="webm">WebM</option>
                          <option value="mkv">MKV</option>
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="playlist-video-quality"
                          className="block text-xs font-medium text-slate-300 mb-1"
                        >
                          Quality
                        </label>
                        <select
                          id="playlist-video-quality"
                          value={playlistVideoQuality}
                          onChange={(e) => setPlaylistVideoQuality(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="best">Best Quality</option>
                          <option value="1080p">1080p</option>
                          <option value="720p">720p</option>
                          <option value="480p">480p</option>
                          <option value="360p">360p</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label
                          htmlFor="playlist-audio-format"
                          className="block text-xs font-medium text-slate-300 mb-1"
                        >
                          Format
                        </label>
                        <select
                          id="playlist-audio-format"
                          value={playlistAudioFormat}
                          onChange={(e) => setPlaylistAudioFormat(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                        >
                          <option value="mp3">MP3</option>
                          <option value="m4a">M4A</option>
                          <option value="opus">Opus</option>
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="playlist-audio-bitrate"
                          className="block text-xs font-medium text-slate-300 mb-1"
                        >
                          Bitrate
                        </label>
                        <select
                          id="playlist-audio-bitrate"
                          value={playlistAudioBitrate}
                          onChange={(e) => setPlaylistAudioBitrate(e.target.value)}
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

                {playlistSummary && (
                  <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-xs text-emerald-300">
                    {playlistSummary}
                  </div>
                )}

                {/* Submit Action */}
                <div className="pt-2 flex justify-between items-center">
                  <span className="text-xs text-slate-400">
                    {selectedVideoIndices.size} video{selectedVideoIndices.size === 1 ? '' : 's'} to download
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadPlaylist}
                    disabled={isPlaylistSubmitting || selectedVideoIndices.size === 0}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg font-medium text-sm text-white transition shadow-md cursor-pointer"
                  >
                    {isPlaylistSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Download Selected ({selectedVideoIndices.size})
                  </button>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Settings Mode */}
        {activeTab === 'settings' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4 animate-in fade-in duration-200">
            <div className="border-b border-slate-700/60 pb-3">
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-rose-500" />
                Application Preferences
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure download folder, queue concurrency limits, filename templates, and default formats.
              </p>
            </div>

            {/* Output Folder */}
            <div className="space-y-1.5">
              <label htmlFor="settings-output-folder" className="block text-xs font-medium text-slate-300">
                Output Folder
              </label>
              <input
                id="settings-output-folder"
                type="text"
                value={outputFolder}
                onChange={(e) => {
                  setOutputFolder(e.target.value)
                  setSettingsSuccessMsg('')
                  setSettingsErrorMsg('')
                }}
                placeholder="~/Downloads/youtube-downloader"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 font-mono"
              />
              <p className="text-[11px] text-slate-400">
                Directory on host where finished downloads are saved. Created if not existing.
              </p>
            </div>

            {/* Max Concurrency */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label htmlFor="settings-concurrency" className="block text-xs font-medium text-slate-300">
                  Max Concurrency (1–10)
                </label>
                <span className="text-xs font-mono text-rose-400 font-semibold">{maxConcurrency}</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="settings-concurrency"
                  type="range"
                  min="1"
                  max="10"
                  value={maxConcurrency}
                  onChange={(e) => {
                    setMaxConcurrency(Number(e.target.value))
                    setSettingsSuccessMsg('')
                    setSettingsErrorMsg('')
                  }}
                  className="flex-1 accent-rose-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  aria-label="parallel-limit-number"
                  value={maxConcurrency}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(10, Number(e.target.value) || 1))
                    setMaxConcurrency(val)
                    setSettingsSuccessMsg('')
                    setSettingsErrorMsg('')
                  }}
                  className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-100 text-center focus:outline-none focus:ring-2 focus:ring-rose-500/50 font-mono"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Maximum number of parallel downloads allowed at once. Applies dynamically to scheduler.
              </p>
            </div>

            {/* Filename Template */}
            <div className="space-y-1.5">
              <label htmlFor="settings-filename-template" className="block text-xs font-medium text-slate-300">
                Filename Template
              </label>
              <input
                id="settings-filename-template"
                type="text"
                value={filenameTemplate}
                onChange={(e) => {
                  setFilenameTemplate(e.target.value)
                  setSettingsSuccessMsg('')
                  setSettingsErrorMsg('')
                }}
                placeholder="%(title)s.%(ext)s"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50 font-mono"
              />
              <p className="text-[11px] text-slate-400">
                Supported placeholders: <code className="text-rose-400">%(title)s</code>, <code className="text-rose-400">%(uploader)s</code>, <code className="text-rose-400">%(id)s</code>, <code className="text-rose-400">%(ext)s</code>. Must contain <code className="text-rose-400">%(ext)s</code>.
              </p>
            </div>

            {/* Default Format Preferences */}
            <div className="space-y-3 pt-2 border-t border-slate-700/60">
              <h3 className="text-xs font-semibold text-slate-300">Default Format & Quality Preferences</h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-default-video-format" className="block text-xs font-medium text-slate-300 mb-1">
                    Default Video Format
                  </label>
                  <select
                    id="settings-default-video-format"
                    value={settingsVideoFormat}
                    onChange={(e) => {
                      setSettingsVideoFormat(e.target.value)
                      setSettingsSuccessMsg('')
                      setSettingsErrorMsg('')
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  >
                    <option value="mp4">MP4</option>
                    <option value="webm">WebM</option>
                    <option value="mkv">MKV</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="settings-default-video-quality" className="block text-xs font-medium text-slate-300 mb-1">
                    Default Video Quality
                  </label>
                  <select
                    id="settings-default-video-quality"
                    value={settingsVideoQuality}
                    onChange={(e) => {
                      setSettingsVideoQuality(e.target.value)
                      setSettingsSuccessMsg('')
                      setSettingsErrorMsg('')
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  >
                    <option value="best">Best Quality</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                    <option value="360p">360p</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-default-audio-format" className="block text-xs font-medium text-slate-300 mb-1">
                    Default Audio Format
                  </label>
                  <select
                    id="settings-default-audio-format"
                    value={settingsAudioFormat}
                    onChange={(e) => {
                      setSettingsAudioFormat(e.target.value)
                      setSettingsSuccessMsg('')
                      setSettingsErrorMsg('')
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  >
                    <option value="mp3">MP3</option>
                    <option value="m4a">M4A</option>
                    <option value="opus">Opus</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="settings-default-audio-bitrate" className="block text-xs font-medium text-slate-300 mb-1">
                    Default Audio Bitrate
                  </label>
                  <select
                    id="settings-default-audio-bitrate"
                    value={settingsAudioBitrate}
                    onChange={(e) => {
                      setSettingsAudioBitrate(e.target.value)
                      setSettingsSuccessMsg('')
                      setSettingsErrorMsg('')
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                  >
                    <option value="best">Best Quality</option>
                    <option value="320k">320 kbps</option>
                    <option value="192k">192 kbps</option>
                    <option value="128k">128 kbps</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Feedback Messages */}
            {settingsSuccessMsg && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{settingsSuccessMsg}</span>
              </div>
            )}

            {settingsErrorMsg && (
              <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{settingsErrorMsg}</span>
              </div>
            )}

            {/* Save Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={isSettingsSaving}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg font-medium text-sm text-white transition shadow-md cursor-pointer"
              >
                {isSettingsSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <SettingsIcon className="w-4 h-4" />
                )}
                Save Settings
              </button>
            </div>
          </div>
        )}

        {/* Download Queue View */}
        <div id="download-queue">
          <DownloadQueue
            jobs={jobs}
            onCancel={handleCancel}
            onCancelAll={handleCancelAll}
            onRetry={handleRetry}
            onDelete={handleDelete}
            onClearCompleted={handleClearCompleted}
          />
        </div>

        {/* Permanent Legal Notice Footer */}
        <footer className="w-full border-t border-slate-800/80 pt-6 mt-8 text-center text-xs text-slate-400 leading-relaxed">
          Only download content you own or are authorized to download, in compliance with YouTube's Terms of Service and applicable copyright law.
        </footer>
      </div>
    </div>
  )
}
