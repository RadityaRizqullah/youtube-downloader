import { describe, it, expect } from 'vitest'
import { isValidYouTubeUrl, formatDuration } from './utils'

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
