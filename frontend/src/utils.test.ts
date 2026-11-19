import { describe, it, expect } from 'vitest'
import { isValidYouTubeUrl, formatDuration, validateBatchUrls } from './utils'

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

  it('rejects invalid urls', () => {
    expect(isValidYouTubeUrl('https://vimeo.com/12345')).toBe(false)
    expect(isValidYouTubeUrl('not a url')).toBe(false)
    expect(isValidYouTubeUrl('https://youtube.com/watch?v=too_short')).toBe(false)
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
