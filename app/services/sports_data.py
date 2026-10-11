"""Basketball / tennis / cricket on AllSportsAPI (football keeps its own, existing path).

Normalises each sport's very different event shape into one card shape the frontend can
render, with a small sport-specific `detail`. Reuses match_search's tokenizer scoring and
its stale-while-revalidate cache. Field names come from real provider responses.
"""

import asyncio
import os
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from app.services import match_search as ms

SPORTS = {
    "basketball": {"label": "Basketball", "emoji": "🏀"},
    "tennis": {"label": "Tennis", "emoji": "🎾"},
    "cricket": {"label": "Cricket", "emoji": "🏏"},
}

NOW_FRESH, NOW_STALE = 20, 180          # live + upcoming window
PAST_FRESH, PAST_STALE = 300, 6 * 3600  # finished window
DETAIL_FRESH, DETAIL_STALE = 15, 180
CAPS = {"live": 150, "upcoming": 80, "past": 80}
_SCOPE_ORDER = {"live": 0, "upcoming": 1, "past": 2}


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _pair(text):
    m = re.match(r"^\s*(\d+)\s*-\s*(\d+)", _s(text))
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _tz(name: str) -> str:
    try:
        ZoneInfo(name)
        return name
    except Exception:
        return "UTC"


def _starting_at(date_s: str, time_s: str, tz_name: str) -> str:
    if not date_s:
        return ""
    try:
        naive = datetime.strptime(f"{date_s} {time_s or '00:00'}", "%Y-%m-%d %H:%M")
        return naive.replace(tzinfo=ZoneInfo(tz_name)).astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


# ---------------------------------------------------------------- provider

async def _request(sport: str, params: dict) -> list[dict]:
    key = os.getenv("ALLSPORTS_API_KEY", "")
    if not key:
        raise RuntimeError("ALLSPORTS_API_KEY is not set")
    base = os.getenv("ALLSPORTS_BASE_URL", "https://apiv2.allsportsapi.com").rstrip("/")
    # Trailing slash + follow_redirects: AllSportsAPI 301s the bare path.
    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        resp = await client.get(f"{base}/{sport}/", params={**params, "APIkey": key})
    resp.raise_for_status()
    data = resp.json()
    if str(data.get("success")) != "1":
        raise RuntimeError(f"AllSportsAPI error: {data.get('result')}")
    return data.get("result") or []


# ---------------------------------------------------------------- mapping

def _classify(ev: dict) -> str:
    status = _s(ev.get("event_status")).lower()
    if str(ev.get("event_live")) == "1":
        return "live"
    if status in ("", "not started", "upcoming", "scheduled", "tbd"):
        return "upcoming"
    if status.startswith("finished") or status.startswith("after") or status in (
        "ended", "final", "retired", "walkover", "walk over", "completed"
    ):
        return "finished"
    return "other"


def _base(sport: str, ev: dict, tz: str) -> dict:
    state = _classify(ev)
    date_s = _s(ev.get("event_date") or ev.get("event_date_start"))
    return {
        "sport": sport,
        "fixture_id": ev.get("event_key"),
        "starting_at": _starting_at(date_s, _s(ev.get("event_time")), tz),
        "league": _s(ev.get("league_name")),
        "country": _s(ev.get("country_name")),
        "round": _s(ev.get("league_round")),
        "state": _s(ev.get("event_status")),
        "live": state == "live",
        "finished": state == "finished",
        "upcoming": state == "upcoming",
    }


_BASKET_PERIODS = [("1stQuarter", "Q1"), ("2ndQuarter", "Q2"), ("3rdQuarter", "Q3"), ("4thQuarter", "Q4"), ("Overtime", "OT")]


def _basket_periods(ev: dict) -> list[dict]:
    scores = ev.get("scores")
    out = []
    if not isinstance(scores, dict):
        return out
    known = {k for k, _ in _BASKET_PERIODS}
    for key, label in _BASKET_PERIODS + [(k, k) for k in scores if k not in known]:
        rows = scores.get(key) or []
        if rows and isinstance(rows[0], dict):
            out.append({"label": label, "home": _int(rows[0].get("score_home")), "away": _int(rows[0].get("score_away"))})
    return out


def map_basketball(ev: dict, tz: str = "UTC") -> dict:
    m = _base("basketball", ev, tz)
    h, a = _pair(ev.get("event_final_result"))
    status = _s(ev.get("event_status")).lower()
    periods = _basket_periods(ev)
    went_ot = any(p["label"] == "OT" for p in periods) or bool(re.search(r"\bot\b|overtime", status))
    m.update({
        "home_team": _s(ev.get("event_home_team")), "away_team": _s(ev.get("event_away_team")),
        "home_team_key": ev.get("home_team_key"), "away_team_key": ev.get("away_team_key"),
        "home_team_logo": ev.get("event_home_team_logo") or ev.get("home_team_logo"),
        "away_team_logo": ev.get("event_away_team_logo") or ev.get("away_team_logo"),
        "home_score": h, "away_score": a,
        "home_score_text": "" if h is None else str(h), "away_score_text": "" if a is None else str(a),
        "periods": periods,
        "status_text": (_s(ev.get("event_quarter")) or "LIVE") if m["live"]
                       else ("FT/OT" if went_ot else "FT") if m["finished"] else "",
    })
    return m


def _tennis_sets(ev: dict) -> list[dict]:
    scores, out = ev.get("scores"), []
    if isinstance(scores, list):
        for row in scores:
            if isinstance(row, dict) and (row.get("score_first") not in (None, "") or row.get("score_second") not in (None, "")):
                out.append({"label": f"Set {_s(row.get('score_set')) or len(out) + 1}",
                            "home": _int(row.get("score_first")), "away": _int(row.get("score_second"))})
    return out


def map_tennis(ev: dict, tz: str = "UTC") -> dict:
    m = _base("tennis", ev, tz)
    h, a = _pair(ev.get("event_final_result"))
    status = _s(ev.get("event_status"))
    low = status.lower()
    winner = _s(ev.get("event_winner")).lower()
    game = _s(ev.get("event_game_result"))
    m.update({
        "home_team": _s(ev.get("event_first_player")), "away_team": _s(ev.get("event_second_player")),
        "home_team_key": ev.get("first_player_key"), "away_team_key": ev.get("second_player_key"),
        "home_team_logo": ev.get("event_first_player_logo"), "away_team_logo": ev.get("event_second_player_logo"),
        "home_score": h, "away_score": a,
        "home_score_text": "" if h is None else str(h), "away_score_text": "" if a is None else str(a),
        "periods": _tennis_sets(ev),
        "game_score": "" if game in ("", "-") else game,
        "serving": {"first player": "home", "second player": "away"}.get(_s(ev.get("event_serve")).lower()),
        "winner": "home" if winner.startswith("first") else "away" if winner.startswith("second") else None,
        "status_text": status if m["live"] else
                       ("RET" if low.startswith("retired") else "W/O" if "walk" in low else "FT") if m["finished"] else "",
    })
    return m


def map_cricket(ev: dict, tz: str = "UTC") -> dict:
    m = _base("cricket", ev, tz)
    info = _s(ev.get("event_status_info"))
    m.update({
        "home_team": _s(ev.get("event_home_team")), "away_team": _s(ev.get("event_away_team")),
        "home_team_key": ev.get("home_team_key"), "away_team_key": ev.get("away_team_key"),
        "home_team_logo": ev.get("event_home_team_logo"), "away_team_logo": ev.get("event_away_team_logo"),
        "home_score": None, "away_score": None,
        "home_score_text": _s(ev.get("event_home_final_result")), "away_score_text": _s(ev.get("event_away_final_result")),
        "periods": [],
        "match_type": _s(ev.get("event_type")),
        "status_text": (info or _s(ev.get("event_status")) or "LIVE") if m["live"] else info or "Finished" if m["finished"] else "",
    })
    return m


MAPPERS = {"basketball": map_basketball, "tennis": map_tennis, "cricket": map_cricket}


def _extras(sport: str, ev: dict) -> dict:
    if sport == "basketball":
        stats = [
            {"type": _s(r.get("type")), "home": _s(r.get("home")), "away": _s(r.get("away"))}
            for r in ev.get("statistics") or [] if isinstance(r, dict)
        ]
        return {"statistics": stats}
    if sport == "tennis":
        return {"qualification": _s(ev.get("event_qualification")) == "True"}
    if sport == "cricket":
        return {
            "toss": _s(ev.get("event_toss")), "man_of_match": _s(ev.get("event_man_of_match")),
            "stadium": _s(ev.get("event_stadium")), "home_rr": _s(ev.get("event_home_rr")),
            "away_rr": _s(ev.get("event_away_rr")), "result": _s(ev.get("event_status_info")),
        }
    return {}


# ---------------------------------------------------------------- windows

async def _fixtures(sport: str, start, end, tz: str) -> list[dict]:
    events = await _request(sport, {"met": "Fixtures", "from": start.isoformat(), "to": end.isoformat(), "timezone": tz})
    mapper = MAPPERS[sport]
    # map immediately and drop the raw event (tennis events carry huge point-by-point arrays)
    return [mapper(ev, tz) for ev in events if isinstance(ev, dict) and ev.get("event_key") is not None]


def _local_today(tz: str):
    return datetime.now(timezone.utc).astimezone(ZoneInfo(tz)).date()


async def _now_window(sport: str, tz: str) -> list[dict]:
    t = _local_today(tz)
    return await ms._swr(f"sport:{sport}:now:{tz}", lambda: _fixtures(sport, t - timedelta(days=1), t + timedelta(days=1), tz),
                         NOW_FRESH, NOW_STALE)


async def _past_window(sport: str, days: int, tz: str) -> list[dict]:
    t = _local_today(tz)
    return await ms._swr(f"sport:{sport}:past:{days}:{tz}", lambda: _fixtures(sport, t - timedelta(days=days), t, tz),
                         PAST_FRESH, PAST_STALE)


def _epoch(m: dict) -> float:
    try:
        return datetime.fromisoformat(m.get("starting_at")).timestamp()
    except Exception:
        return 0.0


# ---------------------------------------------------------------- public

async def list_matches(sport: str, scope: str = "all", query: str = "", days: int = 3, display_timezone: str = "UTC") -> list[dict]:
    if sport not in SPORTS:
        raise ValueError(f"unsupported sport: {sport}")
    scope = scope if scope in ("all", "live", "upcoming", "past") else "all"
    days, tz = ms._clamp_days(days), _tz(display_timezone)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    jobs = {}
    if scope in ("all", "live", "upcoming"):
        jobs["now"] = _now_window(sport, tz)
    if scope in ("all", "past"):
        jobs["past"] = _past_window(sport, days, tz)
    names = list(jobs)
    got = dict(zip(names, await asyncio.gather(*jobs.values(), return_exceptions=True)))
    if all(isinstance(v, Exception) for v in got.values()):
        raise next(iter(got.values()))

    items, seen = [], set()

    def take(m, tag):
        fid = str(m.get("fixture_id"))
        if fid in seen:
            return
        seen.add(fid)
        d = dict(m)
        d["scope"] = tag
        items.append(d)

    for m in (got.get("now") if not isinstance(got.get("now"), Exception) else None) or []:
        if m["live"] and scope in ("all", "live"):
            take(m, "live")
        elif m["upcoming"] and scope in ("all", "upcoming"):
            take(m, "upcoming")
    for m in (got.get("past") if not isinstance(got.get("past"), Exception) else None) or []:
        if m["finished"] and cutoff.timestamp() <= (_epoch(m) or now.timestamp()) <= now.timestamp():
            take(m, "past")

    variants = ms.query_variants(query) if query else []
    if variants:
        scored = []
        for m in items:
            score, kind = ms.score_match(variants, m)
            if score >= ms.MIN_SCORE:
                m["_search_score"], m["matched_on"] = round(score, 1), kind
                scored.append(m)
        scored.sort(key=lambda m: (-m["_search_score"], _SCOPE_ORDER[m["scope"]],
                                   -_epoch(m) if m["scope"] == "past" else _epoch(m)))
        return scored[: ms.MAX_RESULTS]

    out = []
    for tag in ("live", "upcoming", "past"):
        group = [m for m in items if m["scope"] == tag]
        if tag == "live":
            group.sort(key=lambda m: (m.get("league") or "", _epoch(m)))
        elif tag == "upcoming":
            group.sort(key=_epoch)
        else:
            group.sort(key=_epoch, reverse=True)
        out.extend(group[: CAPS[tag]])
    return out


async def fetch_detail(sport: str, match_id, display_timezone: str = "UTC") -> dict | None:
    if sport not in SPORTS:
        raise ValueError(f"unsupported sport: {sport}")
    tz = _tz(display_timezone)

    async def load():
        events = await _request(sport, {"met": "Fixtures", "matchId": match_id, "timezone": tz})
        ev = events[0] if events else None
        if not ev:
            return None
        data = MAPPERS[sport](ev, tz)
        data["extras"] = _extras(sport, ev)
        data["generated_at"] = int(time.time())
        return data

    return await ms._swr(f"sport:{sport}:detail:{match_id}:{tz}", load, DETAIL_FRESH, DETAIL_STALE)
