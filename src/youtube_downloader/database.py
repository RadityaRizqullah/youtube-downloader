from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

# ponytail: simple SQLite file in current dir; configurable via env or settings in later ticket
DB_PATH = Path("./youtube_downloader.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
    # ponytail: lightweight column migration for sqlite; upgrade to alembic when schema changes proliferate
    with engine.connect() as conn:
        for col, default_val in [("default_audio_format", "'mp3'"), ("default_audio_quality", "'best'")]:
            try:
                conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} VARCHAR DEFAULT {default_val}"))
                conn.commit()
            except Exception:
                pass
