import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from './App'

describe('App Walking Skeleton', () => {
  let mockWebSocket: any

  beforeEach(() => {
    vi.restoreAllMocks()

    class MockWS {
      static instances: MockWS[] = []
      onmessage: ((event: any) => void) | null = null
      close = vi.fn()
      constructor() {
        MockWS.instances.push(this)
        mockWebSocket = this
      }
    }
    vi.stubGlobal('WebSocket', MockWS)
  })

  it('shows inline validation error for invalid URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://not-youtube.com/abc' } })
    fireEvent.blur(input)

    expect(screen.getByText(/valid youtube video url/i)).toBeInTheDocument()
    const infoCalls = fetchSpy.mock.calls.filter(([url]) => url.toString().includes('/api/info'))
    expect(infoCalls).toHaveLength(0)
  })

  it('fetches metadata and renders preview card for valid URL', async () => {
    const mockMeta = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration_s: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/health')) {
        return { ok: true, json: async () => ({ ffmpeg: true, version: '0.1.0' }) } as Response
      }
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockMeta } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })

    const previewBtn = screen.getByRole('button', { name: /preview/i })
    fireEvent.click(previewBtn)

    await waitFor(() => {
      expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument()
    })

    expect(screen.getByText('Rick Astley', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('03:33')).toBeInTheDocument()
    const img = screen.getByAltText(/video thumbnail/i)
    expect(img).toHaveAttribute('src', mockMeta.thumbnail)
  })

  it('clicking download initiates DownloadJob and reflects WebSocket progress to DONE', async () => {
    const mockMeta = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration_s: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    }

    const mockJob = {
      id: 'job-xyz-123',
      url: mockMeta.url,
      title: mockMeta.title,
      uploader: mockMeta.uploader,
      duration_s: mockMeta.duration_s,
      thumbnail: mockMeta.thumbnail,
      format: 'mp4',
      quality: 'best',
      audio_only: false,
      state: 'PENDING',
      progress: 0.0,
      error: null,
      output_path: null,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockMeta } as Response
      }
      if (urlStr.includes('/api/jobs') && opts?.method === 'POST') {
        return { ok: true, json: async () => mockJob } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() => {
      expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument()
    })

    const downloadBtn = screen.getByRole('button', { name: /^download$/i })
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(screen.getByText('PENDING')).toBeInTheDocument()
    })

    // Simulate WebSocket progress update
    act(() => {
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          id: 'job-xyz-123',
          state: 'DOWNLOADING',
          progress: 65.5,
          error: null,
          output_path: null,
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('DOWNLOADING')).toBeInTheDocument()
      expect(screen.getByText('65.5%')).toBeInTheDocument()
    })

    // Simulate WebSocket completion
    act(() => {
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          id: 'job-xyz-123',
          state: 'DONE',
          progress: 100.0,
          error: null,
          output_path: 'C:/Users/Raditya/Downloads/youtube-downloader/Rick Astley.mp4',
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('DONE')).toBeInTheDocument()
      expect(screen.getByText('100.0%')).toBeInTheDocument()
      expect(screen.getByText(/download complete!/i)).toBeInTheDocument()
      expect(screen.getByText(/Rick Astley\.mp4/)).toBeInTheDocument()
    })
  })

  it('allows selecting video format and resolution before download', async () => {
    let sentPayload: any = null
    const mockMeta = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration_s: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      available_qualities: ['1080p', '720p', '360p'],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockMeta } as Response
      }
      if (urlStr.includes('/api/jobs') && opts?.method === 'POST') {
        sentPayload = JSON.parse(opts.body as string)
        return {
          ok: true,
          json: async () => ({
            id: 'job-1',
            ...sentPayload,
            state: 'PENDING',
            progress: 0,
            error: null,
            output_path: null,
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() => {
      expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument()
    })

    // Video format select
    const formatSelect = screen.getByLabelText(/format/i)
    fireEvent.change(formatSelect, { target: { value: 'mkv' } })

    // Video quality select
    const qualitySelect = screen.getByLabelText(/quality/i)
    fireEvent.change(qualitySelect, { target: { value: '720p' } })

    const downloadBtn = screen.getByRole('button', { name: /^download$/i })
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(sentPayload).not.toBeNull()
    })

    expect(sentPayload.format).toBe('mkv')
    expect(sentPayload.quality).toBe('720p')
    expect(sentPayload.audio_only).toBe(false)
  })

  it('allows toggling to audio only mode with audio formats and bitrates', async () => {
    let sentPayload: any = null
    const mockMeta = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration_s: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      available_qualities: ['1080p'],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockMeta } as Response
      }
      if (urlStr.includes('/api/jobs') && opts?.method === 'POST') {
        sentPayload = JSON.parse(opts.body as string)
        return {
          ok: true,
          json: async () => ({
            id: 'job-audio-1',
            ...sentPayload,
            state: 'PENDING',
            progress: 0,
            error: null,
            output_path: null,
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() => {
      expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument()
    })

    // Toggle Audio Only
    const audioToggle = screen.getByRole('button', { name: /audio only/i })
    fireEvent.click(audioToggle)

    // Audio format and bitrate selects
    const formatSelect = screen.getByLabelText(/format/i)
    fireEvent.change(formatSelect, { target: { value: 'opus' } })

    const bitrateSelect = screen.getByLabelText(/bitrate|quality/i)
    fireEvent.change(bitrateSelect, { target: { value: '320k' } })

    const downloadBtn = screen.getByRole('button', { name: /^download$/i })
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(sentPayload).not.toBeNull()
    })

    expect(sentPayload.format).toBe('opus')
    expect(sentPayload.quality).toBe('320k')
    expect(sentPayload.audio_only).toBe(true)
  })

  it('displays MERGING state from WebSocket updates', async () => {
    const mockMeta = {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      uploader: 'Rick Astley',
      duration_s: 213,
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockMeta } as Response
      }
      if (urlStr.includes('/api/jobs') && opts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'job-merge-1',
            url: mockMeta.url,
            title: mockMeta.title,
            uploader: mockMeta.uploader,
            duration_s: mockMeta.duration_s,
            thumbnail: mockMeta.thumbnail,
            format: 'mp4',
            quality: 'best',
            audio_only: false,
            state: 'PENDING',
            progress: 0,
            error: null,
            output_path: null,
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const input = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))

    await waitFor(() => {
      expect(screen.getByText('Rick Astley - Never Gonna Give You Up')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^download$/i }))

    await waitFor(() => {
      expect(screen.getByText('PENDING')).toBeInTheDocument()
    })

    act(() => {
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          id: 'job-merge-1',
          state: 'MERGING',
          progress: 100.0,
          error: null,
          output_path: null,
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('MERGING')).toBeInTheDocument()
    })
  })

  it('loads existing queue on startup and allows cancel, retry, clear', async () => {
    const existingJobs = [
      {
        id: 'job-active-1',
        url: 'https://youtube.com/watch?v=1',
        title: 'Initial Active Job',
        uploader: 'Channel 1',
        duration_s: 100,
        thumbnail: null,
        format: 'mp4',
        quality: '1080p',
        audio_only: false,
        state: 'DOWNLOADING',
        progress: 30.0,
        error: null,
        output_path: null,
      },
      {
        id: 'job-failed-1',
        url: 'https://youtube.com/watch?v=2',
        title: 'Initial Failed Job',
        uploader: 'Channel 2',
        duration_s: 200,
        thumbnail: null,
        format: 'mp3',
        quality: '320k',
        audio_only: true,
        state: 'FAILED',
        progress: 0.0,
        error: 'Network timeout',
        output_path: null,
      },
    ]

    let cancelCalledWith = ''
    let cancelAllCalled = false
    let retryCalledWith = ''
    let clearCompletedCalled = false

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/jobs') && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return { ok: true, json: async () => existingJobs } as Response
      }
      if (urlStr.includes('/api/jobs/job-active-1/cancel') && opts?.method === 'POST') {
        cancelCalledWith = 'job-active-1'
        return {
          ok: true,
          json: async () => ({ ...existingJobs[0], state: 'CANCELLED', error: 'Cancelled by user' }),
        } as Response
      }
      if (urlStr.includes('/api/jobs/cancel-all') && opts?.method === 'POST') {
        cancelAllCalled = true
        return { ok: true, json: async () => ({ cancelled: 1 }) } as Response
      }
      if (urlStr.includes('/retry') && opts?.method === 'POST') {
        const id = urlStr.split('/jobs/')[1].split('/retry')[0]
        retryCalledWith = id
        return {
          ok: true,
          json: async () => ({ ...existingJobs[1], state: 'PENDING', error: null, progress: 0 }),
        } as Response
      }
      if (urlStr.includes('/api/jobs/clear-completed') && opts?.method === 'POST') {
        clearCompletedCalled = true
        return { ok: true, json: async () => ({ cleared: 1 }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    // Verify initial queue loaded
    await waitFor(() => {
      expect(screen.getByText('Initial Active Job')).toBeInTheDocument()
      expect(screen.getByText('Initial Failed Job')).toBeInTheDocument()
    })

    // Test Cancel single job
    const cancelBtn = screen.getByRole('button', { name: /^cancel$/i })
    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(cancelCalledWith).toBe('job-active-1')
    })

    // Test Retry failed job
    const retryBtn = screen.getByRole('button', { name: /^retry$/i })
    fireEvent.click(retryBtn)
    await waitFor(() => {
      expect(retryCalledWith).toBe('job-failed-1')
    })

    // Test Cancel All
    const cancelAllBtn = screen.getByRole('button', { name: /cancel all/i })
    fireEvent.click(cancelAllBtn)
    await waitFor(() => {
      expect(cancelAllCalled).toBe(true)
    })

    // Test Clear Completed
    const clearCompletedBtn = screen.getByRole('button', { name: /clear completed/i })
    fireEvent.click(clearCompletedBtn)
    await waitFor(() => {
      expect(clearCompletedCalled).toBe(true)
    })
  })

  it('switches to Batch Download tab and shows inline validation for invalid URLs', async () => {
    render(<App />)

    const batchTabBtn = screen.getByRole('button', { name: /batch download/i })
    fireEvent.click(batchTabBtn)

    const textarea = screen.getByPlaceholderText(/paste youtube urls/i)
    expect(textarea).toBeInTheDocument()

    fireEvent.change(textarea, {
      target: {
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://example.com/invalid-link',
      },
    })

    await waitFor(() => {
      expect(screen.getByText(/line 2:/i)).toBeInTheDocument()
      expect(screen.getByText(/invalid youtube url format/i)).toBeInTheDocument()
    })
  })

  it('submits batch download with unified format selection and shows summary', async () => {
    let batchPayload: any = null
    const mockBatchResponse = {
      queued: [
        {
          id: 'batch-job-1',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: null,
          uploader: null,
          duration_s: null,
          thumbnail: null,
          format: 'mp4',
          quality: '720p',
          audio_only: false,
          state: 'PENDING',
          progress: 0.0,
          error: null,
          output_path: null,
        },
      ],
      failed: [{ url: 'not-valid', error: 'Invalid YouTube URL format' }],
      total_submitted: 2,
      total_queued: 1,
      total_failed: 1,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/jobs/batch') && opts?.method === 'POST') {
        batchPayload = JSON.parse(opts.body as string)
        return {
          ok: true,
          json: async () => mockBatchResponse,
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    // Switch to Batch tab
    fireEvent.click(screen.getByRole('button', { name: /batch download/i }))

    const textarea = screen.getByPlaceholderText(/paste youtube urls/i)
    fireEvent.change(textarea, {
      target: {
        value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ\nnot-valid',
      },
    })

    // Select 720p quality
    const qualitySelect = screen.getByLabelText(/quality/i)
    fireEvent.change(qualitySelect, { target: { value: '720p' } })

    const queueBatchBtn = screen.getByRole('button', { name: /queue batch/i })
    fireEvent.click(queueBatchBtn)

    await waitFor(() => {
      expect(batchPayload).not.toBeNull()
    })

    expect(batchPayload.urls).toEqual([
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'not-valid',
    ])
    expect(batchPayload.quality).toBe('720p')
    expect(batchPayload.format).toBe('mp4')
    expect(batchPayload.audio_only).toBe(false)

    // Verify batch queued job appears in queue list
    await waitFor(() => {
      expect(screen.getByText('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeInTheDocument()
      expect(screen.getByText(/queued 1 job/i)).toBeInTheDocument()
    })
  })

  it('switches to Playlist tab, previews playlist, renders header and video checklist', async () => {
    const mockPlaylist = {
      url: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4',
      title: 'Lex Fridman Podcast',
      uploader: 'Lex Fridman',
      video_count: 2,
      videos: [
        {
          url: 'https://www.youtube.com/watch?v=vid1',
          title: 'Episode 1 - Sam Altman',
          uploader: 'Lex Fridman',
          duration_s: 3600,
          thumbnail: 'https://example.com/thumb1.jpg',
        },
        {
          url: 'https://www.youtube.com/watch?v=vid2',
          title: 'Episode 2 - Elon Musk',
          uploader: 'Lex Fridman',
          duration_s: 1800,
          thumbnail: 'https://example.com/thumb2.jpg',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockPlaylist } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    // Switch to Playlist tab
    const playlistTabBtn = screen.getByRole('button', { name: /^playlist download$/i })
    fireEvent.click(playlistTabBtn)

    const input = screen.getByPlaceholderText(/paste youtube playlist url/i)
    fireEvent.change(input, {
      target: { value: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4' },
    })

    const previewBtn = screen.getByRole('button', { name: /preview playlist/i })
    fireEvent.click(previewBtn)

    await waitFor(() => {
      expect(screen.getByText('Lex Fridman Podcast')).toBeInTheDocument()
      expect(screen.getByText('2 videos')).toBeInTheDocument()
    })

    expect(screen.getByText('Episode 1 - Sam Altman')).toBeInTheDocument()
    expect(screen.getByText('Episode 2 - Elon Musk')).toBeInTheDocument()
    expect(screen.getByText('60:00')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()
  })

  it('handles Select All and Deselect All toggles and submits selection to /api/jobs/playlist', async () => {
    let playlistPayload: any = null
    const mockPlaylist = {
      url: 'https://www.youtube.com/playlist?list=PL12345',
      title: 'Tech Talks',
      uploader: 'Tech Channel',
      video_count: 2,
      videos: [
        {
          url: 'https://www.youtube.com/watch?v=talk1',
          title: 'Talk 1',
          uploader: 'Tech Channel',
          duration_s: 120,
          thumbnail: 'https://example.com/t1.jpg',
        },
        {
          url: 'https://www.youtube.com/watch?v=talk2',
          title: 'Talk 2',
          uploader: 'Tech Channel',
          duration_s: 240,
          thumbnail: 'https://example.com/t2.jpg',
        },
      ],
    }

    const mockResponse = {
      queued: [
        {
          id: 'job-pl-1',
          url: 'https://www.youtube.com/watch?v=talk1',
          title: 'Talk 1',
          uploader: 'Tech Channel',
          duration_s: 120,
          thumbnail: 'https://example.com/t1.jpg',
          format: 'mp4',
          quality: '720p',
          audio_only: false,
          state: 'PENDING',
          progress: 0.0,
          error: null,
          output_path: null,
        },
      ],
      failed: [],
      total_submitted: 1,
      total_queued: 1,
      total_failed: 0,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockPlaylist } as Response
      }
      if (urlStr.includes('/api/jobs/playlist') && opts?.method === 'POST') {
        playlistPayload = JSON.parse(opts.body as string)
        return { ok: true, json: async () => mockResponse } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /^playlist download$/i }))
    const input = screen.getByPlaceholderText(/paste youtube playlist url/i)
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/playlist?list=PL12345' } })
    fireEvent.click(screen.getByRole('button', { name: /preview playlist/i }))

    await waitFor(() => {
      expect(screen.getByText('Tech Talks')).toBeInTheDocument()
    })

    // Deselect all
    const deselectBtn = screen.getByRole('button', { name: /deselect all/i })
    fireEvent.click(deselectBtn)

    // Checkbox for talk 1 only
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    fireEvent.click(checkboxes[0]) // Select Talk 1

    // Select 720p quality
    const qualitySelect = screen.getByLabelText(/quality/i)
    fireEvent.change(qualitySelect, { target: { value: '720p' } })

    const downloadBtn = screen.getByRole('button', { name: /download selected/i })
    fireEvent.click(downloadBtn)

    await waitFor(() => {
      expect(playlistPayload).not.toBeNull()
    })

    expect(playlistPayload.videos).toHaveLength(1)
    expect(playlistPayload.videos[0].url).toBe('https://www.youtube.com/watch?v=talk1')
    expect(playlistPayload.videos[0].title).toBe('Talk 1')
    expect(playlistPayload.quality).toBe('720p')
    expect(playlistPayload.format).toBe('mp4')
  })

  it('auto-switches to Playlist tab when a playlist URL is pasted in single video input', async () => {
    const mockPlaylist = {
      url: 'https://www.youtube.com/playlist?list=PL12345',
      title: 'Auto Switch Playlist',
      uploader: 'Channel',
      video_count: 1,
      videos: [
        {
          url: 'https://www.youtube.com/watch?v=vid1',
          title: 'Auto Vid 1',
          uploader: 'Channel',
          duration_s: 100,
          thumbnail: 'https://example.com/thumb.jpg',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/info')) {
        return { ok: true, json: async () => mockPlaylist } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    const singleInput = screen.getByPlaceholderText(/paste youtube video url/i)
    fireEvent.change(singleInput, {
      target: { value: 'https://www.youtube.com/playlist?list=PL12345' },
    })

    await waitFor(() => {
      expect(screen.getByText('Auto Switch Playlist')).toBeInTheDocument()
    })

    // Confirm Playlist tab is now active
    const playlistTabBtn = screen.getByRole('button', { name: /^playlist download$/i })
    expect(playlistTabBtn.className).toContain('text-rose-400')
  })

  it('renders dismissible FFmpeg warning banner when ffmpeg is false, and allows dismissing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/health')) {
        return { ok: true, json: async () => ({ ffmpeg: false, version: '0.1.0' }) } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/ffmpeg was not detected/i)).toBeInTheDocument()
    })

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissBtn)

    expect(screen.queryByText(/ffmpeg was not detected/i)).not.toBeInTheDocument()
  })

  it('renders permanent legal disclaimer in footer', async () => {
    render(<App />)

    const footer = screen.getByRole('contentinfo')
    expect(footer).toBeInTheDocument()
    expect(footer).toHaveTextContent(/only download content you own or are authorized to download/i)
  })

  it('navigates to Settings tab, displays and updates settings via PUT /api/settings', async () => {
    const mockSettings = {
      output_folder: '~/Downloads/youtube-downloader',
      max_concurrency: 3,
      filename_template: '%(title)s.%(ext)s',
      default_format: 'mp4',
      default_quality: 'best',
      default_audio_format: 'mp3',
      default_audio_quality: 'best',
    }

    let putPayload: {
      output_folder?: string
      max_concurrency?: number
      filename_template?: string
    } | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/settings')) {
        if (opts?.method === 'PUT') {
          putPayload = JSON.parse(opts.body as string)
          return { ok: true, json: async () => ({ ...mockSettings, ...putPayload }) } as Response
        }
        return { ok: true, json: async () => mockSettings } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    // Click Settings tab
    const settingsTab = screen.getByRole('button', { name: /settings/i })
    fireEvent.click(settingsTab)

    await waitFor(() => {
      expect(screen.getByLabelText(/output folder/i)).toHaveValue('~/Downloads/youtube-downloader')
      expect(screen.getByLabelText(/^max concurrency/i)).toHaveValue('3')
      expect(screen.getByLabelText(/filename template/i)).toHaveValue('%(title)s.%(ext)s')
    })

    // Update settings
    fireEvent.change(screen.getByLabelText(/output folder/i), {
      target: { value: 'D:/CustomDownloads' },
    })
    fireEvent.change(screen.getByLabelText(/^max concurrency/i), {
      target: { value: '6' },
    })
    fireEvent.change(screen.getByLabelText(/filename template/i), {
      target: { value: '%(uploader)s/%(title)s.%(ext)s' },
    })

    const saveBtn = screen.getByRole('button', { name: /save settings/i })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(putPayload).not.toBeNull()
    })

    expect(putPayload!.output_folder).toBe('D:/CustomDownloads')
    expect(putPayload!.max_concurrency).toBe(6)
    expect(putPayload!.filename_template).toBe('%(uploader)s/%(title)s.%(ext)s')
    expect(screen.getByText(/settings saved successfully/i)).toBeInTheDocument()
  })

  it('displays error message when saving settings fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const urlStr = url.toString()
      if (urlStr.includes('/api/settings')) {
        if (opts?.method === 'PUT') {
          return {
            ok: false,
            json: async () => ({ detail: 'Output folder is not writable' }),
          } as Response
        }
        return {
          ok: true,
          json: async () => ({
            output_folder: '~/Downloads/youtube-downloader',
            max_concurrency: 3,
            filename_template: '%(title)s.%(ext)s',
            default_format: 'mp4',
            default_quality: 'best',
            default_audio_format: 'mp3',
            default_audio_quality: 'best',
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/output folder/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(screen.getByText(/output folder is not writable/i)).toBeInTheDocument()
    })
  })
})

