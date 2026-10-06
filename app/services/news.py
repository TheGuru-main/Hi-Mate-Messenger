import re
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

    cards = ev.get("cards") or []
    substitutes = ev.get("substitutes") or []

    yellow_cards = []
    red_cards = []
    substitutions = []

    for card in cards:
        if not isinstance(card, dict):
            continue

        card_type = str(card.get("card") or "").strip().lower()

        player = (
            card.get("home_fault")
            or card.get("away_fault")
            or ""
        )

        side = "home" if card.get("home_fault") else "away"

        item = {
            "time": card.get("time"),
            "player": player,
            "side": side,
            "type": card_type,
        }

        if "yellow" in card_type:
            yellow_cards.append(item)

        elif "red" in card_type:
            red_cards.append(item)

    for sub in substitutes:
        if not isinstance(sub, dict):
            continue

        time_value = sub.get("time")

        home = sub.get("home_scorer")
        away = sub.get("away_scorer")

        if isinstance(home, dict) and (
            home.get("in") or home.get("out")
        ):
            substitutions.append({
                "time": time_value,
                "side": "home",
                "player_in": home.get("in") or "",
                "player_out": home.get("out") or "",
            })

        if isinstance(away, dict) and (
            away.get("in") or away.get("out")
        ):
            substitutions.append({
                "time": time_value,
                "side": "away",
                "player_in": away.get("in") or "",
                "player_out": away.get("out") or "",
            })

    return {
        "fixture_id": ev.get("event_key"),
        "name": f"{ev.get('event_home_team')} vs {ev.get('event_away_team')}",

        "home_team": ev.get("event_home_team"),
        "away_team": ev.get("event_away_team"),

        "home_team_key": ev.get("home_team_key"),
        "away_team_key": ev.get("away_team_key"),

        "home_team_logo": ev.get("home_team_logo"),
        "away_team_logo": ev.get("away_team_logo"),

        "home_score": home_score,
        "away_score": away_score,

        "minute": None if upcoming else ev.get("event_status"),
        "state": ev.get("event_status"),

        "starting_at": (
            f"{ev.get('event_date')}T"
            f"{ev.get('event_time')}:00Z"
        ),

        "league": ev.get("league_name"),
        "country": ev.get("country_name"),

        "yellow_cards": yellow_cards,
        "red_cards": red_cards,
        "substitutions": substitutions,

        "yellow_card_count": len(yellow_cards),
        "red_card_count": len(red_cards),
        "substitution_count": len(substitutions),

        "upcoming": upcoming,
    }


async def _allsports_request(params: dict) -> list[dict]:
    if not settings.ALLSPORTS_API_KEY:
        return []
    full_params = {
        "APIkey": settings.ALLSPORTS_API_KEY,
        "timezone": "UTC",
        **params,
    }
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
    """Only matches that are actually live.

    FINISHED is a hard exclusion even if the provider briefly leaves
    event_live=1 during its transition.
    """
    cache_key = "allsports:live"
    cached = _get_cached(cache_key, ttl_seconds=5)

    if cached is not None:
        return cached

    events = await _allsports_request({
        "met": "Livescore",
    })

    terminal_statuses = {
        "finished",
        "ft",
        "full time",
        "full-time",
        "ended",
        "complete",
        "completed",
        "cancelled",
        "canceled",
        "postponed",
        "abandoned",
        "suspended",
    }

    results = []

    for ev in events:
        status = str(
            ev.get("event_status") or ""
        ).strip().lower()

        event_live = str(
            ev.get("event_live") or ""
        ).strip()

        # Hard rule:
        # FINISHED can never enter LiveSports.
        if status in terminal_statuses:
            continue

        # Provider's live flag must also say live.
        if event_live != "1":
            continue

        results.append(
            _map_event(ev, upcoming=False)
        )

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


def tokenize_club_name(value: str) -> list[str]:
    """
    Hi-Mate LiveSports tokenizer.

    Normalizes club names so searches like:
      "man u"
      "Man United"
      "manchester united"
      "manchester-united"

    can all participate in matching.
    """
    value = (value or "").lower()

    # Normalize common football punctuation.
    value = re.sub(r"['’`]", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)

    stop_words = {
        "fc",
        "cf",
        "sc",
        "afc",
        "ac",
        "club",
        "football",
        "fk",
        "the",
    }

    tokens = [
        token
        for token in value.split()
        if token and token not in stop_words
    ]

    aliases = {
        "utd": "united",
        "man": "manchester",
        "psg": "paris",
        "inter": "internazionale",
        "ath": "athletic",
    }

    return [
        aliases.get(token, token)
        for token in tokens
    ]


def score_club_search(query: str, match: dict) -> float:
    query_tokens = tokenize_club_name(query)

    if not query_tokens:
        return 0.0

    home = tokenize_club_name(
        match.get("home_team")
    )
    away = tokenize_club_name(
        match.get("away_team")
    )

    query_text = " ".join(query_tokens)
    home_text = " ".join(home)
    away_text = " ".join(away)

    best = 0.0

    for team_tokens, team_text in (
        (home, home_text),
        (away, away_text),
    ):
        if not team_tokens:
            continue

        if query_text == team_text:
            best = max(best, 100.0)

        elif team_text.startswith(query_text):
            best = max(best, 90.0)

        elif query_text in team_text:
            best = max(best, 80.0)

        matched = sum(
            1
            for token in query_tokens
            if any(
                t.startswith(token) or token.startswith(t)
                for t in team_tokens
            )
        )

        if matched:
            score = (
                matched / len(query_tokens)
            ) * 70.0

            best = max(best, score)

    return best


async def search_live_sports(query: str) -> list[dict]:
    """Search directly across live and upcoming fixtures."""
    query = (query or "").strip()

    if not query:
        return []

    live = await fetch_live_fixtures()
    upcoming = await fetch_upcoming_fixtures(hours=168)

    seen = set()
    matches = []

    for match in [*live, *upcoming]:
        fixture_id = str(
            match.get("fixture_id") or ""
        )

        if fixture_id in seen:
            continue

        seen.add(fixture_id)

        score = score_club_search(
            query,
            match,
        )

        if score <= 0:
            continue

        result = dict(match)
        result["_search_score"] = score
        matches.append(result)

    matches.sort(
        key=lambda item: (
            -item["_search_score"],
            item.get("starting_at") or "",
        )
    )

    return matches[:30]


async def fetch_fixture_stats(fixture_id: int) -> dict | None:
    """Detailed stats for a single fixture — the 'fold' content, separate from chat."""
    cache_key = f"allsports:stats:{fixture_id}"
    cached = _get_cached(cache_key, ttl_seconds=20)
    if cached is not None:
        return cached

    events = await _allsports_request({
        "met": "Fixtures",
        "matchId": fixture_id,
        "withPlayerStats": "1",
    })
    data = events[0] if events else None
    if data:
        _set_cached(cache_key, data)
    return data
