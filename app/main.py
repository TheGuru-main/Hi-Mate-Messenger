import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.config import get_settings
from app.routes import (
    auth, users, messages, klique, posts, search, news, smart_search,
    pairwise, location, reccord, elastic_search, media, settings as settings_route,
    match_room, status,
)
from app.sockets.routes import router as ws_router
from app.sockets.calls import router as calls_ws_router
from app.services.match_poller import poll_live_matches

from app import models  # noqa: F401

settings = get_settings()

app = FastAPI(
    title="Hi-Mate API",
    version="1.0.0.1",
    description="Core Hi-Mate messenger API — identity, placement, messaging, "
                 "Klique/Follow/Fan, feed, search, relationship-grid crawler, "
                 "secondary letter-pair grid, RECCORD DB, location, media, settings, "
                 "live sports match rooms.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/v1")
app.include_router(users.router, prefix="/v1")
app.include_router(messages.router, prefix="/v1")
app.include_router(klique.router, prefix="/v1")
app.include_router(posts.router, prefix="/v1")
app.include_router(search.router, prefix="/v1")
app.include_router(news.router, prefix="/v1")
app.include_router(smart_search.router, prefix="/v1")
app.include_router(pairwise.router, prefix="/v1")
app.include_router(location.router, prefix="/v1")
app.include_router(reccord.router, prefix="/v1")
app.include_router(elastic_search.router, prefix="/v1")
app.include_router(media.router, prefix="/v1")
app.include_router(settings_route.router, prefix="/v1")
app.include_router(match_room.router, prefix="/v1")
app.include_router(status.router, prefix="/v1")
app.include_router(ws_router)
app.include_router(calls_ws_router)


@app.on_event("startup")
async def on_startup():
    Base.metadata.create_all(bind=engine)

    # One-time, idempotent column additions that create_all() can't do
    # (it only creates missing tables, never alters existing ones).
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_refs TEXT;"))
        conn.execute(text("ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_comment_id UUID;"))
        conn.execute(text("ALTER TABLE reactions ADD COLUMN IF NOT EXISTS comment_id UUID;"))
        conn.execute(text("ALTER TABLE reactions ALTER COLUMN post_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_ref TEXT;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_image_ref TEXT;"))
        conn.execute(text("ALTER TABLE groups ADD COLUMN IF NOT EXISTS description TEXT;"))
        conn.execute(text("ALTER TABLE groups ADD COLUMN IF NOT EXISTS purpose TEXT;"))
        conn.commit()
    # Background task — polls live matches for score changes, pushes
    # goal events into match rooms. Fire-and-forget on the running
    # event loop; Render keeps this process alive as a persistent
    # web service, so this loop just keeps running alongside requests.
    asyncio.create_task(poll_live_matches())


@app.get("/")
def health_check():
    return {"status": "ok", "service": "himate-api", "version": "1.0.0.1"}
