"""
News/Sports feed integration — GNews for general news, Sportmonk for
football/league data, including live scores. Powers the "News"/"Sports"
Feed Categories plus the match watch-room feature.
"""
import time
from typing import Any

import httpx

from app.config import get_settings

settings = get_settings()

_cache: dict[str, tuple[float, Any]] = {}


def _get_cached(key: str, ttl_seconds: int | None = None) -> Any | None:
    entry = _cache.get(key)
    if not entry:
        return None
    cached_at, data = entry
    ttl = ttl_seconds if ttl_seconds is not None else settings.NEWS_CACHE_MINUTES * 60
    if time.time() - cached_at > ttl:
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
        "category": topic, "lang": "en", "country": country,
        "max": limit, "apikey": settings.GNEWS_API_KEY,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get("https://gnews.io/api/v4/top-headlines", params=params)
        if response.status_code != 200:
            return []
        articles = response.json().get("articles", [])

    results = [
        {
            "source": "gnews", "title": a.get("title"), "description": a.get("description"),
            "url": a.get("url"), "image": a.get("image"), "published_at": a.get("publishedAt"),
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
        {"source": "sportmonk", "fixture_id": f.get("id"), "name": f.get("name"),
         "starting_at": f.get("starting_at"), "league_id": f.get("league_id")}
        for f in fixtures
    ]
    _set_cached(cache_key, results)
    return results


def _extract_current_score(scores: list[dict]) -> dict:
    """
    Sportmonk v3 shape (confirmed): each score entry has
    score.participant ("home"/"away") and score.goals as SEPARATE
    fields — you filter to description=="CURRENT" and read both entries,
    one per side. Returns {"home": int|None, "away": int|None}.
    """
    result = {"home": None, "away": None}
    for s in scores:
        if s.get("description") != "CURRENT":
            continue
        inner = s.get("score", {})
        side = inner.get("participant")  # "home" or "away"
        goals = inner.get("goals")
        if side in ("home", "away"):
            result[side] = goals
    return result


async def fetch_live_fixtures() -> list[dict]:
    """Currently in-play matches. Short 30s cache — needs to feel real-time."""
    cache_key = "sportmonk:livescores"
    cached = _get_cached(cache_key, ttl_seconds=30)
    if cached is not None:
        return cached

    if not settings.SPORTMONK_API_KEY:
        return []

    url = f"{settings.SPORTMONK_BASE_URL}/livescores"
    params = {"api_token": settings.SPORTMONK_API_KEY, "include": "scores;participants"}

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return []
        matches = response.json().get("data", [])

    results = []
    for m in matches:
        participants = m.get("participants", [])
        home = next((p.get("name") for p in participants if p.get("meta", {}).get("location") == "home"), None)
        away = next((p.get("name") for p in participants if p.get("meta", {}).get("location") == "away"), None)
        current_score = _extract_current_score(m.get("scores", []))
        results.append({
            "fixture_id": m.get("id"),
            "name": m.get("name") or f"{home} vs {away}",
            "home_team": home,
            "away_team": away,
            "home_score": current_score.get("home") or 0,
            "away_score": current_score.get("away") or 0,
            "minute": m.get("periods", [{}])[-1].get("minutes") if m.get("periods") else None,
            "state": m.get("state_id"),
        })
    _set_cached(cache_key, results)
    return results


async def fetch_fixture_stats(fixture_id: int) -> dict | None:
    """Detailed stats for a single fixture — the 'fold' content, separate from chat."""
    cache_key = f"sportmonk:stats:{fixture_id}"
    cached = _get_cached(cache_key, ttl_seconds=20)
    if cached is not None:
        return cached

    if not settings.SPORTMONK_API_KEY:
        return None

    url = f"{settings.SPORTMONK_BASE_URL}/fixtures/{fixture_id}"
    params = {"api_token": settings.SPORTMONK_API_KEY, "include": "statistics;events;scores;participants"}

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return None
        data = response.json().get("data")

    if data:
        _set_cached(cache_key, data)
    return data


async def fetch_upcoming_fixtures(hours: int = 34) -> list[dict]:
    """Fixtures that have not kicked off yet, next `days` days (UTC). 5-minute cache."""
    from datetime import datetime, timedelta, timezone

    cache_key = f"sportmonk:upcoming:{hours}"
    cached = _get_cached(cache_key, ttl_seconds=300)
    if cached is not None:
        return cached
    if not settings.SPORTMONK_API_KEY:
        return []

    now = datetime.now(timezone.utc)
    start = now.date().isoformat()
    end = (now + timedelta(hours=hours)).date().isoformat()
    url = f"{settings.SPORTMONK_BASE_URL}/fixtures/between/{start}/{end}"
    params = {"api_token": settings.SPORTMONK_API_KEY, "include": "participants;league", "per_page": 50}

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return []
        fixtures = response.json().get("data", [])

    results = []
    for m in fixtures:
        try:
            kickoff = datetime.strptime(m.get("starting_at"), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            continue
        if kickoff <= now or kickoff > now + timedelta(hours=hours):
            continue
        participants = m.get("participants", [])
        home = next((p.get("name") for p in participants if p.get("meta", {}).get("location") == "home"), None)
        away = next((p.get("name") for p in participants if p.get("meta", {}).get("location") == "away"), None)
        results.append({
            "fixture_id": m.get("id"),
            "name": m.get("name") or f"{home} vs {away}",
            "home_team": home,
            "away_team": away,
            "home_score": 0,
            "away_score": 0,
            "minute": None,
            "state": m.get("state_id"),
            "starting_at": kickoff.isoformat(),
            "league": (m.get("league") or {}).get("name"),
            "upcoming": True,
        })
    results.sort(key=lambda r: r["starting_at"])
    _set_cached(cache_key, results)
    return results
