from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.config import get_settings
from app.routes import (
    auth, users, messages, klique, posts, search, news, smart_search,
    pairwise, location, reccord, elastic_search, media, settings as settings_route,
)
from app.sockets.routes import router as ws_router
from app.sockets.calls import router as calls_ws_router

# Import models so Base knows about every table before create_all runs
from app import models  # noqa: F401

settings = get_settings()

app = FastAPI(
    title="Hi-Mate API",
    version="1.0.0.1",
    description="Core Hi-Mate messenger API — identity, placement, messaging, "
                 "Klique/Follow/Fan, feed, search, relationship-grid crawler, "
                 "secondary letter-pair grid, RECCORD DB, location, media, settings.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,  # set ALLOWED_ORIGINS env var in Render once frontend URL exists
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
app.include_router(ws_router)       # WebSocket routes stay unprefixed
app.include_router(calls_ws_router)  # call signaling, also unprefixed


@app.on_event("startup")
def on_startup():
    # Creates tables if they don't exist. Fine for early development —
    # Alembic migrations (see /alembic) take over once this is production data.
    Base.metadata.create_all(bind=engine)


@app.get("/")
def health_check():
    return {"status": "ok", "service": "himate-api", "version": "1.0.0.1"}
