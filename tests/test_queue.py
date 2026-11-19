import asyncio
import threading
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from youtube_downloader.database import Base
from youtube_downloader.models import DownloadJob, JobState, Settings
from youtube_downloader.queue import DownloadQueue, QueueManager


from sqlalchemy.pool import StaticPool

@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine, expire_on_commit=False
    )
    session = TestingSessionLocal()

    # Create default settings
    settings = Settings(id=1, max_concurrency=3)
    session.add(settings)
    session.commit()
    session.close()

    return TestingSessionLocal


@pytest.mark.asyncio
async def test_queue_concurrency_limit_strictly_enforced(test_db):
    db = test_db()
    jobs = []
    for i in range(4):
        job = DownloadJob(
            id=f"job-{i}",
            url=f"https://www.youtube.com/watch?v=test{i}",
            state=JobState.PENDING.value,
        )
        db.add(job)
        jobs.append(job)
    db.commit()
    db.close()

    active_count = 0
    max_active_seen = 0
    lock = threading.Lock()
    started_events = [asyncio.Event() for _ in range(4)]
    release_events = [threading.Event() for _ in range(4)]

    def fake_worker(job_id: str, loop, cancel_event=None):
        nonlocal active_count, max_active_seen
        idx = int(job_id.split("-")[1])
        with lock:
            active_count += 1
            if active_count > max_active_seen:
                max_active_seen = active_count
        loop.call_soon_threadsafe(started_events[idx].set)
        release_events[idx].wait(timeout=5)
        with lock:
            active_count -= 1

    qm = QueueManager(session_factory=test_db, max_concurrency=3)

    with patch("youtube_downloader.queue.run_download_job", side_effect=fake_worker):
        for job in jobs:
            await qm.enqueue(job.id)

        await asyncio.wait_for(started_events[0].wait(), timeout=2)
        await asyncio.wait_for(started_events[1].wait(), timeout=2)
        await asyncio.wait_for(started_events[2].wait(), timeout=2)

        await asyncio.sleep(0.05)
        assert not started_events[3].is_set()
        assert max_active_seen == 3

        release_events[0].set()
        await asyncio.wait_for(started_events[3].wait(), timeout=2)
        assert max_active_seen == 3

        for e in release_events:
            e.set()

        await qm.join()


@pytest.mark.asyncio
async def test_cancel_pending_job(test_db):
    db = test_db()
    jobs = []
    for i in range(4):
        job = DownloadJob(
            id=f"cancel-pending-{i}",
            url=f"https://www.youtube.com/watch?v=cp{i}",
            state=JobState.PENDING.value,
        )
        db.add(job)
        jobs.append(job)
    db.commit()
    db.close()

    release_event = threading.Event()
    executed_ids = []

    def fake_worker(job_id: str, loop, cancel_event=None):
        executed_ids.append(job_id)
        release_event.wait(timeout=2)

    qm = QueueManager(session_factory=test_db, max_concurrency=3)

    with patch("youtube_downloader.queue.run_download_job", side_effect=fake_worker):
        for job in jobs:
            await qm.enqueue(job.id)

        success = await qm.cancel(jobs[3].id)
        assert success is True

        db = test_db()
        j3 = db.query(DownloadJob).filter(DownloadJob.id == jobs[3].id).first()
        assert j3.state == JobState.CANCELLED.value
        db.close()

        release_event.set()
        await qm.join()

        assert jobs[3].id not in executed_ids


@pytest.mark.asyncio
async def test_cancel_downloading_job(test_db):
    db = test_db()
    job = DownloadJob(
        id="cancel-active-1",
        url="https://www.youtube.com/watch?v=active1",
        state=JobState.PENDING.value,
    )
    db.add(job)
    db.commit()
    db.close()

    started = asyncio.Event()

    def fake_worker(job_id: str, loop, cancel_event=None):
        loop.call_soon_threadsafe(started.set)
        import time
        t0 = time.time()
        while not (cancel_event and cancel_event.is_set()) and time.time() - t0 < 3:
            time.sleep(0.01)
        wdb = test_db()
        j = wdb.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        j.state = JobState.CANCELLED.value
        wdb.commit()
        wdb.close()

    qm = QueueManager(session_factory=test_db, max_concurrency=1)

    with patch("youtube_downloader.queue.run_download_job", side_effect=fake_worker):
        await qm.enqueue(job.id)
        await asyncio.wait_for(started.wait(), timeout=2)

        success = await qm.cancel(job.id)
        assert success is True

        await qm.join()

        db = test_db()
        refreshed = db.query(DownloadJob).filter(DownloadJob.id == job.id).first()
        assert refreshed.state == JobState.CANCELLED.value
        db.close()


@pytest.mark.asyncio
async def test_cancel_all(test_db):
    db = test_db()
    jobs = []
    for i in range(4):
        job = DownloadJob(
            id=f"cancel-all-{i}",
            url=f"https://www.youtube.com/watch?v=all{i}",
            state=JobState.PENDING.value,
        )
        db.add(job)
        jobs.append(job)
    db.commit()
    db.close()

    started = asyncio.Event()

    def fake_worker(job_id: str, loop, cancel_event=None):
        loop.call_soon_threadsafe(started.set)
        import time
        t0 = time.time()
        while not (cancel_event and cancel_event.is_set()) and time.time() - t0 < 3:
            time.sleep(0.01)
        wdb = test_db()
        j = wdb.query(DownloadJob).filter(DownloadJob.id == job_id).first()
        j.state = JobState.CANCELLED.value
        wdb.commit()
        wdb.close()

    qm = QueueManager(session_factory=test_db, max_concurrency=2)

    with patch("youtube_downloader.queue.run_download_job", side_effect=fake_worker):
        for j in jobs:
            await qm.enqueue(j.id)

        await asyncio.wait_for(started.wait(), timeout=2)

        count = await qm.cancel_all()
        assert count >= 1

        await qm.join()

        db = test_db()
        for j in jobs:
            refreshed = db.query(DownloadJob).filter(DownloadJob.id == j.id).first()
            assert refreshed.state == JobState.CANCELLED.value
        db.close()


@pytest.mark.asyncio
async def test_startup_reloads_pending_and_resets_interrupted(test_db):
    db = test_db()
    # 1 pending job
    j_pending = DownloadJob(
        id="pending-on-boot",
        url="https://www.youtube.com/watch?v=boot1",
        state=JobState.PENDING.value,
    )
    # 1 downloading job that died with previous server
    j_interrupted = DownloadJob(
        id="interrupted-on-boot",
        url="https://www.youtube.com/watch?v=boot2",
        state=JobState.DOWNLOADING.value,
    )
    db.add(j_pending)
    db.add(j_interrupted)
    db.commit()
    db.close()

    enqueued_ids = []

    qm = QueueManager(session_factory=test_db, max_concurrency=3)

    with patch.object(qm, "enqueue", side_effect=lambda j_id: enqueued_ids.append(j_id)):
        await qm.startup()

    assert "pending-on-boot" in enqueued_ids

    # Interrupted job should be marked FAILED
    db = test_db()
    refreshed_interrupted = db.query(DownloadJob).filter(DownloadJob.id == "interrupted-on-boot").first()
    assert refreshed_interrupted.state == JobState.FAILED.value
    assert "interrupted" in (refreshed_interrupted.error or "").lower()
    db.close()


@pytest.mark.asyncio
async def test_retry_job(test_db):
    db = test_db()
    job = DownloadJob(
        id="failed-job-1",
        url="https://www.youtube.com/watch?v=fail1",
        state=JobState.FAILED.value,
        error="Network error",
        progress=45.0,
    )
    db.add(job)
    db.commit()
    db.close()

    qm = QueueManager(session_factory=test_db, max_concurrency=3)
    enqueued_ids = []

    with patch.object(qm, "enqueue", side_effect=lambda j_id: enqueued_ids.append(j_id)):
        retried = await qm.retry("failed-job-1")
        assert retried is not None
        assert retried.state == JobState.PENDING.value
        assert retried.error is None
        assert retried.progress == 0.0
        assert "failed-job-1" in enqueued_ids


@pytest.mark.asyncio
async def test_delete_job_and_clear_completed(test_db):
    db = test_db()
    j1 = DownloadJob(id="done-1", url="http://yt/1", state=JobState.DONE.value)
    j2 = DownloadJob(id="failed-1", url="http://yt/2", state=JobState.FAILED.value)
    j3 = DownloadJob(id="cancelled-1", url="http://yt/3", state=JobState.CANCELLED.value)
    j4 = DownloadJob(id="active-1", url="http://yt/4", state=JobState.DOWNLOADING.value)
    db.add_all([j1, j2, j3, j4])
    db.commit()
    db.close()

    qm = QueueManager(session_factory=test_db, max_concurrency=3)

    # Cannot delete active job
    assert await qm.delete_job("active-1") is False

    # Can delete single terminal job
    assert await qm.delete_job("done-1") is True

    # Clear completed should remove failed and cancelled, but keep active
    cleared = await qm.clear_completed()
    assert cleared == 2

    db = test_db()
    remaining = db.query(DownloadJob).all()
    assert len(remaining) == 1
    assert remaining[0].id == "active-1"
    db.close()


@pytest.mark.asyncio
async def test_disk_db_persistence_across_restarts(tmp_path):
    db_file = tmp_path / "persistent.db"
    db_url = f"sqlite:///{db_file}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    DiskSession = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

    # Initial server run: store settings and jobs
    db = DiskSession()
    settings = Settings(id=1, max_concurrency=2)
    db.add(settings)
    j_pending = DownloadJob(
        id="disk-pending-1",
        url="https://youtube.com/watch?v=disk1",
        state=JobState.PENDING.value,
    )
    j_active = DownloadJob(
        id="disk-active-1",
        url="https://youtube.com/watch?v=disk2",
        state=JobState.DOWNLOADING.value,
    )
    j_done = DownloadJob(
        id="disk-done-1",
        url="https://youtube.com/watch?v=disk3",
        state=JobState.DONE.value,
        output_path="/downloads/disk3.mp4",
    )
    db.add_all([j_pending, j_active, j_done])
    db.commit()
    db.close()
    engine.dispose()

    # Simulate server reboot: new engine, new queue instance attached to same disk file
    reboot_engine = create_engine(db_url, connect_args={"check_same_thread": False})
    RebootSession = sessionmaker(autocommit=False, autoflush=False, bind=reboot_engine, expire_on_commit=False)
    rebooted_qm = DownloadQueue(session_factory=RebootSession)

    enqueued_after_reboot = []
    with patch.object(rebooted_qm, "enqueue", side_effect=lambda j_id: enqueued_after_reboot.append(j_id)):
        await rebooted_qm.startup()

    # Settings restored
    assert rebooted_qm.max_concurrency == 2
    # Pending job reloaded into memory queue
    assert "disk-pending-1" in enqueued_after_reboot

    # Verify disk DB records
    verify_db = RebootSession()
    interrupted = verify_db.query(DownloadJob).filter(DownloadJob.id == "disk-active-1").first()
    assert interrupted.state == JobState.FAILED.value
    assert "interrupted" in (interrupted.error or "").lower()

    done = verify_db.query(DownloadJob).filter(DownloadJob.id == "disk-done-1").first()
    assert done.state == JobState.DONE.value
    assert done.output_path == "/downloads/disk3.mp4"
    verify_db.close()
    reboot_engine.dispose()


@pytest.mark.asyncio
async def test_dynamic_concurrency_update(test_db):
    db = test_db()
    j0 = DownloadJob(id="dyn-0", url="https://www.youtube.com/watch?v=dyn0", state=JobState.PENDING.value)
    j1 = DownloadJob(id="dyn-1", url="https://www.youtube.com/watch?v=dyn1", state=JobState.PENDING.value)
    db.add(j0)
    db.add(j1)
    db.commit()
    db.close()

    started_events = [asyncio.Event(), asyncio.Event()]
    release_events = [threading.Event(), threading.Event()]

    def fake_worker(job_id: str, loop, cancel_event=None):
        idx = int(job_id.split("-")[1])
        loop.call_soon_threadsafe(started_events[idx].set)
        release_events[idx].wait(timeout=5)

    qm = DownloadQueue(session_factory=test_db, max_concurrency=1)
    assert qm.max_concurrency == 1

    with pytest.raises(ValueError):
        await qm.update_concurrency(0)

    with patch("youtube_downloader.queue.run_download_job", side_effect=fake_worker):
        # Enqueue both
        t0 = asyncio.create_task(qm.enqueue("dyn-0"))
        t1 = asyncio.create_task(qm.enqueue("dyn-1"))

        # dyn-0 should start, dyn-1 should remain waiting because max_concurrency is 1
        await asyncio.wait_for(started_events[0].wait(), timeout=2.0)
        await asyncio.sleep(0.05)
        assert not started_events[1].is_set()

        # Dynamically increase concurrency to 2 -> dyn-1 should immediately wake and run
        await qm.update_concurrency(2)
        assert qm.max_concurrency == 2
        await asyncio.wait_for(started_events[1].wait(), timeout=2.0)
        assert started_events[1].is_set()

        # Release both jobs
        release_events[0].set()
        release_events[1].set()
        await asyncio.gather(t0, t1)




