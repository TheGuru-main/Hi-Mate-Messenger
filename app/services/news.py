"""
News/Sports feed integration — GNews for general news, AllSportsAPI for
football/league data, including live scores and upcoming fixtures.
"""
import time
from datetime import datetime, timedelta, timezone
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


def _parse_result(result_str: str | None) -> tuple[int, int]:
    """'1 - 2' -> (1, 2). Returns (0, 0) if missing/unparseable."""
    if not result_str or "-" not in result_str:
        return (0, 0)
    try:
        home, away = [p.strip() for p in result_str.split("-", 1)]
        return (int(home), int(away))
    except (ValueError, TypeError):
        return (0, 0)


def _map_event(ev: dict, upcoming: bool = False) -> dict:
    home_score, away_score = _parse_result(ev.get("event_final_result"))
    return {
        "fixture_id": ev.get("event_key"),
        "name": f"{ev.get('event_home_team')} vs {ev.get('event_away_team')}",
        "home_team": ev.get("event_home_team"),
        "away_team": ev.get("event_away_team"),
        "home_score": home_score,
        "away_score": away_score,
        "minute": None if upcoming else ev.get("event_status"),
        "state": ev.get("event_status"),
        "starting_at": f"{ev.get('event_date')}T{ev.get('event_time')}:00",
        "league": ev.get("league_name"),
        "country": ev.get("country_name"),
        "upcoming": upcoming,
    }


async def _allsports_request(params: dict) -> list[dict]:
    if not settings.ALLSPORTS_API_KEY:
        return []
    full_params = {"APIkey": settings.ALLSPORTS_API_KEY, **params}
    # AllSportsAPI 301-redirects "/football" (no trailing slash) to "/football/"
    # (with one) — httpx does NOT follow redirects by default, so without both
    # the trailing slash and follow_redirects=True every request here would
    # silently come back as a 301 and get swallowed as "no results".
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        response = await client.get(f"{settings.ALLSPORTS_BASE_URL}/football/", params=full_params)
        if response.status_code != 200:
            return []
        data = response.json()
        if not data.get("success"):
            return []
        result = data.get("result")
        return result if isinstance(result, list) else []


async def fetch_live_fixtures() -> list[dict]:
    """Currently in-play matches. Short 30s cache — needs to feel real-time."""
    cache_key = "allsports:live"
    cached = _get_cached(cache_key, ttl_seconds=30)
    if cached is not None:
        return cached

    events = await _allsports_request({"met": "Livescore"})
    results = [_map_event(ev, upcoming=False) for ev in events]
    _set_cached(cache_key, results)
    return results


NOT_STARTED_STATUSES = {
    "",
    "not started",
    "scheduled",
    "schedule",
    "tbd",
    "to be played",
}

EXCLUDED_UPCOMING_STATUSES = {
    "finished",
    "ft",
    "full time",
    "cancelled",
    "canceled",
    "postponed",
    "abandoned",
    "suspended",
    "walkover",
}


def _is_upcoming_event_status(status: str) -> bool:
    """
    AllSportsAPI uses slightly different status values across fixtures.
    Treat known scheduled states as upcoming, while explicitly rejecting
    live/finished/cancelled/postponed states.
    """
    value = (status or "").strip().lower()

    if value in EXCLUDED_UPCOMING_STATUSES:
        return False

    if not value:
        return True

    if value in NOT_STARTED_STATUSES:
        return True

    # Live football statuses are normally minute values such as "23",
    # "45", "90", "HT", etc. Do not allow those into Upcoming.
    if value.isdigit():
        return False

    live_markers = {
        "ht",
        "half time",
        "live",
        "1h",
        "2h",
        "et",
        "extra time",
        "penalties",
    }

    if value in live_markers:
        return False

    # Unknown non-terminal statuses are safer to treat as scheduled
    # than to silently discard legitimate future fixtures.
    return True


async def fetch_upcoming_fixtures(hours: int = 34) -> list[dict]:
    """
    Fixtures that have not kicked off yet, next `hours` hours. 5-minute cache.

    We deliberately do NOT compare AllSportsAPI's event_date/event_time
    against our own UTC "now" to decide what's upcoming — we don't have
    confirmation of what timezone those fields are actually reported in,
    and guessing wrong would silently let already-started/finished matches
    through (which is exactly what happened before this fix). Instead we
    trust AllSportsAPI's own event_status field, which is authoritative:
    empty string or "Not Started" means genuinely upcoming; anything else
    (a live minute number, "Finished", "Postponed", etc.) is not.
    """
    cache_key = f"allsports:upcoming:{hours}"
    cached = _get_cached(cache_key, ttl_seconds=300)
    if cached is not None:
        return cached

    now = datetime.now(timezone.utc)
    start = now.date().isoformat()
    end = (now + timedelta(hours=hours)).date().isoformat()
    events = await _allsports_request({"met": "Fixtures", "from": start, "to": end})

    results = []
    for ev in events:
        status = (ev.get("event_status") or "").strip()

        if not _is_upcoming_event_status(status):
            continue

        mapped = _map_event(ev, upcoming=True)
        results.append(mapped)

    results.sort(key=lambda r: (r.get("starting_at") or ""))
    _set_cached(cache_key, results)
    return results


async def fetch_fixture_stats(fixture_id: int) -> dict | None:
    """Detailed stats for a single fixture — the 'fold' content, separate from chat."""
    cache_key = f"allsports:stats:{fixture_id}"
    cached = _get_cached(cache_key, ttl_seconds=20)
    if cached is not None:
        return cached

    events = await _allsports_request({"met": "Fixtures", "matchId": fixture_id})
    data = events[0] if events else None
    if data:
        _set_cached(cache_key, data)
    return data
