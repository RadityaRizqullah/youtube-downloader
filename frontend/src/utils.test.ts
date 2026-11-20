import { describe, it, expect } from 'vitest'
import {
  isValidYouTubeUrl,
  isPlaylistUrl,
  formatDuration,
  validateBatchUrls,
  extractVideoId,
  formatTimestamp,
  parseTimestamp,
} from './utils'

describe('isValidYouTubeUrl', () => {
  it('accepts standard youtube watch url', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(isValidYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts youtu.be short url', () => {
    expect(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts shorts url', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts playlist url', () => {
    expect(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4')).toBe(true)
    expect(isValidYouTubeUrl('https://youtube.com/playlist?list=PL12345')).toBe(true)
  })

  it('rejects invalid urls', () => {
    expect(isValidYouTubeUrl('https://vimeo.com/12345')).toBe(false)
    expect(isValidYouTubeUrl('not a url')).toBe(false)
    expect(isValidYouTubeUrl('https://youtube.com/watch?v=too_short')).toBe(false)
  })
})

describe('isPlaylistUrl', () => {
  it('detects valid playlist urls', () => {
    expect(isPlaylistUrl('https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4')).toBe(true)
    expect(isPlaylistUrl('https://youtube.com/playlist?list=PL12345')).toBe(true)
  })

  it('returns false for single video urls without playlist', () => {
    expect(isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    expect(isPlaylistUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(false)
  })
})

describe('formatDuration', () => {
  it('formats seconds into mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(213)).toBe('03:33')
    expect(formatDuration(3600)).toBe('60:00')
  })
})

describe('extractVideoId', () => {
  it('extracts 11-char ID from watch url', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from youtu.be url', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('extracts ID from shorts url', () => {
    expect(extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('returns null for non-video or invalid url', () => {
    expect(extractVideoId('https://example.com/video')).toBeNull()
    expect(extractVideoId('not-a-url')).toBeNull()
  })
})

describe('formatTimestamp', () => {
  it('formats MM:SS under an hour', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(65)).toBe('01:05')
    expect(formatTimestamp(213)).toBe('03:33')
  })

  it('formats HH:MM:SS over an hour', () => {
    expect(formatTimestamp(3600)).toBe('01:00:00')
    expect(formatTimestamp(3665)).toBe('01:01:05')
  })
})

describe('parseTimestamp', () => {
  it('parses seconds, MM:SS, and HH:MM:SS', () => {
    expect(parseTimestamp('45')).toBe(45)
    expect(parseTimestamp('01:30')).toBe(90)
    expect(parseTimestamp('1:05:20')).toBe(3920)
  })

  it('returns null for invalid inputs', () => {
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('abc')).toBeNull()
    expect(parseTimestamp('01:65')).toBeNull()
    expect(parseTimestamp('-10')).toBeNull()
  })
})

describe('validateBatchUrls', () => {
  it('trims whitespace and ignores blank lines', () => {
    const input = `
      https://www.youtube.com/watch?v=dQw4w9WgXcQ  
      
      https://youtu.be/9bZkp7q19f0   
    `
    const result = validateBatchUrls(input)
    expect(result.validUrls).toEqual([
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/9bZkp7q19f0',
    ])
    expect(result.invalidEntries).toHaveLength(0)
    expect(result.entries).toHaveLength(2)
  })

  it('identifies and highlights invalid lines with error message', () => {
    const input = `https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://example.com/not-youtube\nnot-even-a-url`
    const result = validateBatchUrls(input)
    expect(result.validUrls).toEqual(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
    expect(result.invalidEntries).toHaveLength(2)
    expect(result.invalidEntries[0].lineNumber).toBe(2)
    expect(result.invalidEntries[0].error).toBe('Invalid YouTube URL format')
    expect(result.invalidEntries[1].lineNumber).toBe(3)
  })
})
