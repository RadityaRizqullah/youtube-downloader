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
