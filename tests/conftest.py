import pytest
from youtube_downloader.database import init_db


@pytest.fixture(autouse=True)
def setup_database():
    init_db()
    yield
