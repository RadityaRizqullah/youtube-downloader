const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})([^\s]*)$/

export function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url.trim())
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

