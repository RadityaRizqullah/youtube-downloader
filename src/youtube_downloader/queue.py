import asyncio
from datetime import datetime, timezone
import threading
from typing import Callable, Optional
from sqlalchemy.orm import Session

from youtube_downloader.database import SessionLocal
from youtube_downloader.downloader import run_download_job
from youtube_downloader.models import DownloadJob, JobState, Settings
from youtube_downloader.ws import manager


class DownloadQueue:
    def __init__(
        self,
        session_factory: Optional[Callable[[], Session]] = None,
        max_concurrency: int = 3,
    ) -> None:
        self._session_factory = session_factory or SessionLocal
        self.max_concurrency = max_concurrency
        self._condition = asyncio.Condition()
        self._running_count = 0
        self._tasks: set[asyncio.Task] = set()
        self._cancel_events: dict[str, threading.Event] = {}

    async def update_concurrency(self, new_limit: int) -> None:
        if new_limit < 1:
            raise ValueError("Concurrency must be at least 1")
        self.max_concurrency = new_limit
        async with self._condition:
            self._condition.notify_all()

    async def enqueue(self, job_id: str) -> None:
        loop = asyncio.get_running_loop()
        cancel_event = threading.Event()
        self._cancel_events[job_id] = cancel_event

        task = asyncio.create_task(self._process_job(job_id, loop, cancel_event))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _process_job(
        self, job_id: str, loop: asyncio.AbstractEventLoop, cancel_event: threading.Event
    ) -> None:
        async with self._condition:
            await self._condition.wait_for(
                lambda: self._running_count < self.max_concurrency or cancel_event.is_set()
            )
            if cancel_event.is_set():
                self._cancel_events.pop(job_id, None)
                return
            self._running_count += 1

        try:
            db = self._session_factory()
            try:
                job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
                if not job or job.state == JobState.CANCELLED.value:
                    return
            finally:
                db.close()

            try:
                await loop.run_in_executor(None, run_download_job, job_id, loop, cancel_event)
            finally:
                self._cancel_events.pop(job_id, None)
        finally:
            async with self._condition:
                self._running_count -= 1
                self._condition.notify_all()

    async def cancel(self, job_id: str) -> bool:
        cancel_event = self._cancel_events.get(job_id)
        if cancel_event:
            cancel_event.set()
            async with self._condition:
                self._condition.notify_all()

        db = self._session_factory()
        try:
            job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
            if not job or job.state in JobState.terminal_states():
                return False

            job.state = JobState.CANCELLED.value
            job.error = "Cancelled by user"
            db.commit()

            await manager.broadcast({
                "id": job.id,
                "state": job.state,
                "progress": job.progress,
                "error": job.error,
                "output_path": None,
            })
            return True
        finally:
            db.close()

    async def cancel_all(self) -> int:
        db = self._session_factory()
        cancelled_count = 0
        try:
            non_terminal = db.query(DownloadJob).filter(
                DownloadJob.state.in_(JobState.active_states())
            ).all()
            for job in non_terminal:
                cancel_event = self._cancel_events.get(job.id)
                if cancel_event:
                    cancel_event.set()
                job.state = JobState.CANCELLED.value
                job.error = "Cancelled by user"
                cancelled_count += 1
                await manager.broadcast({
                    "id": job.id,
                    "state": job.state,
                    "progress": job.progress,
                    "error": job.error,
                    "output_path": None,
                })
            db.commit()
            async with self._condition:
                self._condition.notify_all()
            return cancelled_count
        finally:
            db.close()

    async def retry(self, job_id: str) -> Optional[DownloadJob]:
        db = self._session_factory()
        try:
            job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
            if not job or job.state != JobState.FAILED.value:
                return None

            job.state = JobState.PENDING.value
            job.progress = 0.0
            job.error = None
            job.output_path = None
            job.created_at = datetime.now(timezone.utc)
            db.commit()

            await manager.broadcast({
                "id": job.id,
                "state": job.state,
                "progress": job.progress,
                "error": None,
                "output_path": None,
            })

            await self.enqueue(job.id)
            return job
        finally:
            db.close()

    async def delete_job(self, job_id: str) -> bool:
        db = self._session_factory()
        try:
            job = db.query(DownloadJob).filter(DownloadJob.id == job_id).first()
            if not job or job.state not in JobState.terminal_states():
                return False

            db.delete(job)
            db.commit()
            return True
        finally:
            db.close()

    async def clear_completed(self) -> int:
        db = self._session_factory()
        try:
            terminal_jobs = db.query(DownloadJob).filter(
                DownloadJob.state.in_(JobState.terminal_states())
            ).all()
            count = len(terminal_jobs)
            for job in terminal_jobs:
                db.delete(job)
            db.commit()
            return count
        finally:
            db.close()

    async def startup(self) -> None:
        db = self._session_factory()
        try:
            settings = db.query(Settings).first()
            if settings and settings.max_concurrency:
                self.max_concurrency = settings.max_concurrency

            interrupted_jobs = db.query(DownloadJob).filter(
                DownloadJob.state.in_([
                    JobState.DOWNLOADING.value,
                    JobState.MERGING.value,
                ])
            ).all()
            for job in interrupted_jobs:
                job.state = JobState.FAILED.value
                job.error = "Download interrupted by server restart"
            db.commit()

            pending_jobs = (
                db.query(DownloadJob)
                .filter(DownloadJob.state == JobState.PENDING.value)
                .order_by(DownloadJob.created_at.asc())
                .all()
            )
            for job in pending_jobs:
                await self.enqueue(job.id)
        finally:
            db.close()

    async def join(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)


QueueManager = DownloadQueue
