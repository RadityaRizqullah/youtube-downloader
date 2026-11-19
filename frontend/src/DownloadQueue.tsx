import { AlertCircle, CheckCircle2, Film, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { formatDuration } from './utils'

export type JobState =
  | 'PENDING'
  | 'FETCHING'
  | 'DOWNLOADING'
  | 'MERGING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED'

export interface DownloadJob {
  id: string
  url: string
  title: string | null
  uploader: string | null
  duration_s: number | null
  thumbnail: string | null
  format: string
  quality: string
  audio_only: boolean
  state: JobState
  progress: number
  error: string | null
  output_path: string | null
  created_at?: string
}

interface DownloadQueueProps {
  jobs: DownloadJob[]
  onCancel: (jobId: string) => void
  onCancelAll: () => void
  onRetry: (jobId: string) => void
  onDelete: (jobId: string) => void
  onClearCompleted: () => void
}

export function DownloadQueue({
  jobs,
  onCancel,
  onCancelAll,
  onRetry,
  onDelete,
  onClearCompleted,
}: DownloadQueueProps) {
  if (jobs.length === 0) {
    return null
  }

  const hasActiveJobs = jobs.some((j) =>
    ['PENDING', 'DOWNLOADING', 'MERGING'].includes(j.state)
  )
  const hasTerminalJobs = jobs.some((j) => ['DONE', 'FAILED', 'CANCELLED'].includes(j.state))

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-lg space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
        <div className="flex items-center space-x-2">
          <h2 className="text-base font-semibold text-slate-100">Download Queue</h2>
          <span className="text-xs bg-slate-700 text-slate-300 font-mono px-2 py-0.5 rounded-full">
            {jobs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveJobs && (
            <button
              onClick={onCancelAll}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/60 text-rose-300 hover:text-rose-200 text-xs font-medium rounded-lg transition cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              Cancel All
            </button>
          )}
          {hasTerminalJobs && (
            <button
              onClick={onClearCompleted}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600/60 text-slate-300 hover:text-slate-100 text-xs font-medium rounded-lg transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Completed
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {jobs.map((job, idx) => {
          const isTerminal = ['DONE', 'FAILED', 'CANCELLED'].includes(job.state)
          const isCancellable = ['PENDING', 'DOWNLOADING', 'MERGING'].includes(job.state)
          const isRetryable = job.state === 'FAILED'

          return (
            <div
              key={job.id || idx}
              className="bg-slate-900/80 border border-slate-700/70 rounded-lg p-3.5 flex flex-col gap-2.5 transition"
            >
              <div className="flex items-start gap-3">
                {/* Thumbnail */}
                <div className="w-20 h-14 shrink-0 rounded bg-slate-950 overflow-hidden relative flex items-center justify-center border border-slate-800">
                  {job.thumbnail ? (
                    <img
                      src={job.thumbnail}
                      alt="Thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Film className="w-5 h-5 text-slate-600" />
                  )}
                  {job.duration_s ? (
                    <span className="absolute bottom-1 right-1 bg-black/80 font-mono text-[10px] px-1 rounded text-slate-200">
                      {formatDuration(job.duration_s)}
                    </span>
                  ) : null}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200 truncate leading-snug">
                      {job.title || job.url}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {job.created_at && (
                        <span className="text-[11px] text-slate-500 font-mono">
                          {new Date(job.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                          job.state === 'DONE'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : job.state === 'FAILED'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : job.state === 'CANCELLED'
                            ? 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
                            : job.state === 'MERGING'
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {job.state}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    {job.uploader && <span className="truncate max-w-[140px]">{job.uploader}</span>}
                    {job.uploader && <span>•</span>}
                    <span className="uppercase font-mono text-[11px] bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/50">
                      {job.format} • {job.quality}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>
                    {job.state === 'MERGING' ? 'Merging streams...' : 'Progress'}
                  </span>
                  <span className="font-mono">{(job.progress ?? 0).toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 rounded-full ${
                      job.state === 'DONE'
                        ? 'bg-emerald-500'
                        : job.state === 'FAILED'
                        ? 'bg-rose-500'
                        : job.state === 'CANCELLED'
                        ? 'bg-slate-600'
                        : job.state === 'MERGING'
                        ? 'bg-purple-500'
                        : 'bg-rose-600'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, job.progress ?? 0))}%` }}
                  />
                </div>
              </div>

              {/* Error display */}
              {job.state === 'FAILED' && job.error && (
                <div className="flex items-start gap-1.5 p-2 bg-rose-950/40 border border-rose-800/40 rounded text-xs text-rose-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400 mt-0.5" />
                  <span className="break-all">{job.error}</span>
                </div>
              )}

              {/* Output path display */}
              {job.state === 'DONE' && (
                <div className="flex items-start gap-1.5 p-2.5 bg-emerald-950/30 border border-emerald-800/30 rounded text-xs text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="font-medium">Download complete!</p>
                    {job.output_path && (
                      <p className="text-slate-400 font-mono mt-0.5 break-all">
                        Saved: {job.output_path}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons footer */}
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800/80">
                {isCancellable && (
                  <button
                    onClick={() => onCancel(job.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-rose-300 text-xs rounded transition border border-slate-700/60 cursor-pointer"
                  >
                    <XCircle className="w-3 h-3 text-rose-400" />
                    Cancel
                  </button>
                )}

                {isRetryable && (
                  <button
                    onClick={() => onRetry(job.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs rounded transition border border-slate-700/60 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 text-amber-400" />
                    Retry
                  </button>
                )}

                {isTerminal && (
                  <button
                    data-testid={`delete-${job.id}`}
                    onClick={() => onDelete(job.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 hover:text-slate-300 text-xs rounded transition cursor-pointer"
                    title="Delete from list"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
