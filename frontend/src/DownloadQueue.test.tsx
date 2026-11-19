import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DownloadQueue, type DownloadJob } from './DownloadQueue'

describe('DownloadQueue Component', () => {
  const sampleJobs: DownloadJob[] = [
    {
      id: 'job-1',
      url: 'https://youtube.com/watch?v=1',
      title: 'Active Video',
      uploader: 'Creator A',
      duration_s: 120,
      thumbnail: 'https://img.youtube.com/vi/1/0.jpg',
      format: 'mp4',
      quality: '1080p',
      audio_only: false,
      state: 'DOWNLOADING',
      progress: 45.0,
      error: null,
      output_path: null,
      created_at: '2026-11-19T10:00:00Z',
    },
    {
      id: 'job-2',
      url: 'https://youtube.com/watch?v=2',
      title: 'Pending Video',
      uploader: 'Creator B',
      duration_s: 60,
      thumbnail: null,
      format: 'mp3',
      quality: '320k',
      audio_only: true,
      state: 'PENDING',
      progress: 0.0,
      error: null,
      output_path: null,
      created_at: '2026-11-19T09:59:00Z',
    },
    {
      id: 'job-3',
      url: 'https://youtube.com/watch?v=3',
      title: 'Failed Video',
      uploader: null,
      duration_s: null,
      thumbnail: null,
      format: 'mp4',
      quality: 'best',
      audio_only: false,
      state: 'FAILED',
      progress: 10.0,
      error: 'Download stream blocked',
      output_path: null,
      created_at: '2026-11-19T09:58:00Z',
    },
    {
      id: 'job-4',
      url: 'https://youtube.com/watch?v=4',
      title: 'Completed Video',
      uploader: null,
      duration_s: null,
      thumbnail: null,
      format: 'mp4',
      quality: 'best',
      audio_only: false,
      state: 'DONE',
      progress: 100.0,
      error: null,
      output_path: '/downloads/Completed Video.mp4',
      created_at: '2026-11-19T09:57:00Z',
    },
  ]

  it('renders all jobs ordered with titles, states, and error messages', () => {
    render(
      <DownloadQueue
        jobs={sampleJobs}
        onCancel={vi.fn()}
        onCancelAll={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
      />
    )

    expect(screen.getByText('Active Video')).toBeInTheDocument()
    expect(screen.getByText('Pending Video')).toBeInTheDocument()
    expect(screen.getByText('Failed Video')).toBeInTheDocument()
    expect(screen.getByText('Completed Video')).toBeInTheDocument()

    expect(screen.getByText('DOWNLOADING')).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()

    expect(screen.getByText('Download stream blocked')).toBeInTheDocument()
    expect(screen.getByText(/Completed Video\.mp4/)).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button is clicked on DOWNLOADING or PENDING job', () => {
    const handleCancel = vi.fn()
    render(
      <DownloadQueue
        jobs={sampleJobs}
        onCancel={handleCancel}
        onCancelAll={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
      />
    )

    const cancelButtons = screen.getAllByRole('button', { name: /^cancel$/i })
    // Active & Pending jobs both have Cancel buttons
    fireEvent.click(cancelButtons[0])
    expect(handleCancel).toHaveBeenCalledWith('job-1')
  })

  it('calls onCancelAll when Cancel All button is clicked', () => {
    const handleCancelAll = vi.fn()
    render(
      <DownloadQueue
        jobs={sampleJobs}
        onCancel={vi.fn()}
        onCancelAll={handleCancelAll}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
      />
    )

    const cancelAllBtn = screen.getByRole('button', { name: /cancel all/i })
    fireEvent.click(cancelAllBtn)
    expect(handleCancelAll).toHaveBeenCalledTimes(1)
  })

  it('calls onRetry when Retry button is clicked on FAILED job', () => {
    const handleRetry = vi.fn()
    render(
      <DownloadQueue
        jobs={sampleJobs}
        onCancel={vi.fn()}
        onCancelAll={vi.fn()}
        onRetry={handleRetry}
        onDelete={vi.fn()}
        onClearCompleted={vi.fn()}
      />
    )

    const retryBtn = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryBtn)
    expect(handleRetry).toHaveBeenCalledWith('job-3')
  })

  it('calls onDelete and onClearCompleted for completed/terminal jobs', () => {
    const handleDelete = vi.fn()
    const handleClearCompleted = vi.fn()
    render(
      <DownloadQueue
        jobs={sampleJobs}
        onCancel={vi.fn()}
        onCancelAll={vi.fn()}
        onRetry={vi.fn()}
        onDelete={handleDelete}
        onClearCompleted={handleClearCompleted}
      />
    )

    const clearCompletedBtn = screen.getByRole('button', { name: /clear completed/i })
    fireEvent.click(clearCompletedBtn)
    expect(handleClearCompleted).toHaveBeenCalledTimes(1)

    // Click individual delete button on terminal job
    const individualDelete = screen.getByTestId('delete-job-4')
    fireEvent.click(individualDelete)
    expect(handleDelete).toHaveBeenCalledWith('job-4')
  })
})
