"""
News/Sports feed integration — GNews for general news, Sportmonk for
football/league data. Scoped, contained addition: this powers the
"News" and "Sports" Feed Categories with real external content,
nothing more. Not part of the parked AI/LOMINII scope.
"""
import time
from typing import Any

import httpx

from app.config import get_settings

settings = get_settings()

_cache: dict[str, tuple[float, Any]] = {}


def _get_cached(key: str) -> Any | None:
    entry = _cache.get(key)
    if not entry:
        return None
    cached_at, data = entry
    if time.time() - cached_at > settings.NEWS_CACHE_MINUTES * 60:
        return None
    return data


def _set_cached(key: str, data: Any) -> None:
    _cache[key] = (time.time(), data)


async def fetch_general_news(topic: str = "general", country: str = "ng", limit: int = 20) -> list[dict]:
    cache_key = f"gnews:{topic}:{country}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    if not settings.GNEWS_API_KEY:
        return []

    params = {
        "category": topic,
        "lang": "en",
        "country": country,
        "max": limit,
        "apikey": settings.GNEWS_API_KEY,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get("https://gnews.io/api/v4/top-headlines", params=params)
        if response.status_code != 200:
            return []
        articles = response.json().get("articles", [])

    results = [
        {
            "source": "gnews",
            "title": a.get("title"),
            "description": a.get("description"),
            "url": a.get("url"),
            "image": a.get("image"),
            "published_at": a.get("publishedAt"),
        }
        for a in articles
    ]
    _set_cached(cache_key, results)
    return results


async def fetch_football_fixtures(league_id: int | None = None, limit: int = 20) -> list[dict]:
    cache_key = f"sportmonk:fixtures:{league_id}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    if not settings.SPORTMONK_API_KEY:
        return []

    url = f"{settings.SPORTMONK_BASE_URL}/fixtures"
    params = {"api_token": settings.SPORTMONK_API_KEY, "per_page": limit}
    if league_id:
        params["filters"] = f"fixtureLeagues:{league_id}"

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return []
        fixtures = response.json().get("data", [])

    results = [
        {
            "source": "sportmonk",
            "fixture_id": f.get("id"),
            "name": f.get("name"),
            "starting_at": f.get("starting_at"),
            "league_id": f.get("league_id"),
        }
        for f in fixtures
    ]
    _set_cached(cache_key, results)
    return results
