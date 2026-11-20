const YOUTUBE_VIDEO_REGEX =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})([^\s]*)$/

const YOUTUBE_PLAYLIST_REGEX =
  /^(https?:\/\/)?((www|m)\.)?youtube\.com\/playlist\?([^\s]*&)?list=([\w-]+)([^\s]*)$/

export function isPlaylistUrl(url: string): boolean {
  const trimmed = url.trim()
  return (
    YOUTUBE_PLAYLIST_REGEX.test(trimmed) ||
    (trimmed.includes('list=') && (trimmed.includes('playlist') || trimmed.includes('watch')))
  )
}

export function isValidYouTubeUrl(url: string): boolean {
  const trimmed = url.trim()
  return YOUTUBE_VIDEO_REGEX.test(trimmed) || isPlaylistUrl(trimmed)
}

export function extractVideoId(url: string): string | null {
  const trimmed = url.trim()
  const match = trimmed.match(YOUTUBE_VIDEO_REGEX)
  return match ? match[6] : null
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hrs = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`
  }
  return `${pad(mins)}:${pad(secs)}`
}

// ponytail: basic HH:MM:SS or MM:SS parser; upgrade to full ISO 8601 or subsecond duration if needed
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.some((p) => p === '' || isNaN(Number(p)) || Number(p) < 0)) {
    return null
  }
  if (parts.length === 1) {
    const s = Number(parts[0])
    return Number.isInteger(s) ? s : Math.floor(s)
  }
  if (parts.length === 2) {
    const m = Number(parts[0])
    const s = Number(parts[1])
    if (s >= 60) return null
    return m * 60 + s
  }
  if (parts.length === 3) {
    const h = Number(parts[0])
    const m = Number(parts[1])
    const s = Number(parts[2])
    if (m >= 60 || s >= 60) return null
    return h * 3600 + m * 60 + s
  }
  return null
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(mins)}:${pad(secs)}`
}

export interface BatchUrlEntry {
  lineNumber: number
  raw: string
  url: string
  isValid: boolean
  error?: string
}

export interface BatchValidationResult {
  entries: BatchUrlEntry[]
  validUrls: string[]
  invalidEntries: BatchUrlEntry[]
}

// ponytail: line-by-line regex check; upgrade to client-side deduplication if duplicate URL warning is needed
export function validateBatchUrls(rawInput: string): BatchValidationResult {
  const lines = rawInput.split('\n')
  const entries: BatchUrlEntry[] = []
  const validUrls: string[] = []
  const invalidEntries: BatchUrlEntry[] = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return

    const isValid = isValidYouTubeUrl(trimmed)
    const entry: BatchUrlEntry = {
      lineNumber: index + 1,
      raw: line,
      url: trimmed,
      isValid,
      error: isValid ? undefined : 'Invalid YouTube URL format',
    }

    entries.push(entry)
    if (isValid) {
      validUrls.push(trimmed)
    } else {
      invalidEntries.push(entry)
    }
  })

  return { entries, validUrls, invalidEntries }
}

