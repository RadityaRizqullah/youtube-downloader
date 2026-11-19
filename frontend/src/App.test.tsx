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
})

