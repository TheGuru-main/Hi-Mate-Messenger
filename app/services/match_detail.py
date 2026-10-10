"""Match detail aggregation for the LiveSports match room (sports expansion, step 1).

One call returns everything the match fold needs: goals, cards, substitutions,
lineups (with per-player badges), statistics, plus each team's last-5 results
and next-15 fixtures. Reuses news.fetch_fixture_stats() and news._allsports_request().
"""

import asyncio
import re
import time
from datetime import datetime, timedelta, timezone

from app.services import news

LIVE_TTL = 15
UPCOMING_TTL = 300
FINISHED_TTL = 3600
FORM_TTL = 6 * 3600
LAST_N = 5
NEXT_N = 15

_DEAD_STATUSES = {"postponed", "cancelled", "canceled", "abandoned", "awarded", "walkover"}


def _s(value) -> str:
    return "" if value is None else str(value).strip()


def _norm(value) -> str:
    return " ".join(_s(value).lower().split())


def _parse_score(result):
    match = re.match(r"^\s*(\d+)\s*-\s*(\d+)", _s(result))
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _state_of(ev: dict) -> str:
    status = _s(ev.get("event_status"))
    if news._is_upcoming_event_status(status):
        return "upcoming"
    low = status.lower()
    if low.startswith("finished") or low.startswith("after"):
        return "finished"
    if low in _DEAD_STATUSES:
        return "other"
    return "live"


def _minute_value(text: str) -> float:
    """'45+2' -> 45.02 so stoppage-time events sort after the 45th minute."""
    match = re.match(r"^\s*(\d+)(?:\s*\+\s*(\d+))?", _s(text))
    if not match:
        return 999.0
    return int(match.group(1)) + (int(match.group(2)) / 100 if match.group(2) else 0)


# ---------------------------------------------------------------- events

def build_goals(ev: dict) -> list[dict]:
    out = []
    for g in ev.get("goalscorers") or []:
        if not isinstance(g, dict):
            continue
        home, away = _s(g.get("home_scorer")), _s(g.get("away_scorer"))
        side = "home" if home else "away" if away else None
        if not side:
            continue
        low = _s(g.get("info")).lower()
        out.append({
            "minute": _s(g.get("time")),
            "side": side,
            "player": home or away,
            "player_id": g.get("home_scorer_id") if side == "home" else g.get("away_scorer_id"),
            "assist": _s(g.get("home_assist") if side == "home" else g.get("away_assist")),
            "score": _s(g.get("score")),
            "type": "penalty" if "pen" in low else "own_goal" if "own" in low else "goal",
        })
    out.sort(key=lambda x: _minute_value(x["minute"]))
    return out


def build_cards(ev: dict) -> list[dict]:
    out = []
    for c in ev.get("cards") or []:
        if not isinstance(c, dict):
            continue
        home, away = _s(c.get("home_fault")), _s(c.get("away_fault"))
        side = "home" if home else "away" if away else None
        if not side:
            continue
        ctype = _s(c.get("card")).lower()
        kind = "red" if "red" in ctype else "yellow" if "yellow" in ctype else None
        if not kind:
            continue
        out.append({
            "minute": _s(c.get("time")),
            "side": side,
            "player": home or away,
            "player_id": c.get("home_player_id") if side == "home" else c.get("away_player_id"),
            "type": kind,
        })
    out.sort(key=lambda x: _minute_value(x["minute"]))
    return out


def build_substitutions(ev: dict) -> list[dict]:
    out = []
    for sub in ev.get("substitutes") or []:
        if not isinstance(sub, dict):
            continue
        for side in ("home", "away"):
            block = sub.get(f"{side}_scorer")
            if isinstance(block, dict) and (block.get("in") or block.get("out")):
                out.append({
                    "minute": _s(sub.get("time")),
                    "side": side,
                    "player_in": _s(block.get("in")),
                    "player_out": _s(block.get("out")),
                    "in_id": block.get("in_id"),
                    "out_id": block.get("out_id"),
                })
    out.sort(key=lambda x: _minute_value(x["minute"]))
    return out


# ---------------------------------------------------------------- lineups

def _same(item_id, item_name, pid, name) -> bool:
    if pid and item_id and str(pid) == str(item_id):
        return True
    return bool(name) and _norm(item_name) == _norm(name)


def _lineup_side(ev: dict, side: str, goals, cards, subs) -> dict:
    block = ((ev.get("lineups") or {}).get(f"{side}_team")) or {}

    def decorate(p: dict) -> dict:
        name, pid = _s(p.get("player")), p.get("player_key")
        mine_goals = [g for g in goals if g["side"] == side]
        sub_out = next((s for s in subs if s["side"] == side and _same(s["out_id"], s["player_out"], pid, name)), None)
        sub_in = next((s for s in subs if s["side"] == side and _same(s["in_id"], s["player_in"], pid, name)), None)
        return {
            "name": name,
            "number": _s(p.get("player_number")),
            "position": _s(p.get("player_position")),
            "player_id": pid,
            "goals": sum(1 for g in mine_goals if g["type"] != "own_goal" and _same(g["player_id"], g["player"], pid, name)),
            "assists": sum(1 for g in mine_goals if _norm(g["assist"]) and _norm(g["assist"]) == _norm(name)),
            "yellow": sum(1 for c in cards if c["side"] == side and c["type"] == "yellow" and _same(c["player_id"], c["player"], pid, name)),
            "red": sum(1 for c in cards if c["side"] == side and c["type"] == "red" and _same(c["player_id"], c["player"], pid, name)),
            "sub_out": sub_out["minute"] if sub_out else None,
            "sub_in": sub_in["minute"] if sub_in else None,
        }

    coaches = []
    for c in block.get("coaches") or []:
        if isinstance(c, dict):
            name = _s(c.get("coache") or c.get("coach") or c.get("name"))
            if name:
                coaches.append(name)

    missing = []
    for m in block.get("missing_players") or []:
        if isinstance(m, dict):
            name = _s(m.get("player") or m.get("name"))
            if name:
                missing.append({
                    "name": name,
                    "player_id": m.get("player_key"),
                    "reason": _s(m.get("info_reason") or m.get("info") or m.get("reason")),
                })

    return {
        "formation": _s(ev.get(f"event_{side}_formation")),
        "starting": [decorate(p) for p in block.get("starting_lineups") or [] if isinstance(p, dict)],
        "substitutes": [decorate(p) for p in block.get("substitutes") or [] if isinstance(p, dict)],
        "coaches": coaches,
        "missing": missing,
    }


# ---------------------------------------------------------------- form

def _start_iso(ev: dict) -> str:
    try:
        value = news._event_starting_at_utc(ev, "UTC")
        if value:
            return value if isinstance(value, str) else value.isoformat()
    except Exception:
        pass
    date_part, time_part = _s(ev.get("event_date")), _s(ev.get("event_time"))
    return f"{date_part}T{time_part}" if date_part else ""


def _sort_key(ev: dict):
    return (_s(ev.get("event_date")), _s(ev.get("event_time")))


def _row(ev: dict, team_key) -> dict:
    is_home = str(ev.get("home_team_key")) == str(team_key)
    own, opp = ("home", "away") if is_home else ("away", "home")
    row = {
        "fixture_id": ev.get("event_key"),
        "date": _s(ev.get("event_date")),
        "time": _s(ev.get("event_time")),
        "starting_at": _start_iso(ev),
        "league": _s(ev.get("league_name")),
        "home_away": "H" if is_home else "A",
        "opponent": _s(ev.get(f"event_{opp}_team")),
        "opponent_key": ev.get(f"{opp}_team_key"),
        "opponent_logo": ev.get(f"{opp}_team_logo"),
    }
    score = _parse_score(ev.get("event_final_result"))
    if score is not None:
        mine, theirs = score if is_home else (score[1], score[0])
        row.update({
            "for": mine,
            "against": theirs,
            "result": "W" if mine > theirs else "L" if mine < theirs else "D",
            "yellow": sum(1 for c in build_cards(ev) if c["side"] == own and c["type"] == "yellow"),
            "red": sum(1 for c in build_cards(ev) if c["side"] == own and c["type"] == "red"),
            "scorers": [
                {"player": g["player"], "minute": g["minute"], "type": g["type"]}
                for g in build_goals(ev) if g["side"] == own
            ],
        })
    return row


async def _fixtures_for_team(team_key, start, end) -> list[dict]:
    return await news._allsports_request({
        "met": "Fixtures",
        "teamId": team_key,
        "from": start.isoformat(),
        "to": end.isoformat(),
    })


async def team_form(team_key) -> dict:
    """Last 5 finished results + next 15 fixtures for a team. Cached 6h."""
    cache_key = f"allsports:form:{team_key}"
    cached = news._get_cached(cache_key, ttl_seconds=FORM_TTL)
    if cached is not None:
        return cached

    today = datetime.now(timezone.utc).date()
    past, future = await asyncio.gather(
        _fixtures_for_team(team_key, today - timedelta(days=75), today),
        _fixtures_for_team(team_key, today, today + timedelta(days=150)),
    )

    finished = [e for e in past if _state_of(e) == "finished" and _parse_score(e.get("event_final_result"))]
    if len(finished) < LAST_N:  # international breaks / off-season: widen once
        older = await _fixtures_for_team(team_key, today - timedelta(days=210), today - timedelta(days=75))
        finished += [e for e in older if _state_of(e) == "finished" and _parse_score(e.get("event_final_result"))]
    finished.sort(key=_sort_key, reverse=True)
    last = [_row(e, team_key) for e in finished[:LAST_N]]

    upcoming = sorted((e for e in future if _state_of(e) == "upcoming"), key=_sort_key)
    nxt = [_row(e, team_key) for e in upcoming[:NEXT_N]]

    results = [r["result"] for r in last]
    result = {
        "team_key": team_key,
        "last": last,
        "next": nxt,
        "summary": {
            "results": results,
            "wins": results.count("W"),
            "draws": results.count("D"),
            "losses": results.count("L"),
            "goals_for": sum(r["for"] for r in last),
            "goals_against": sum(r["against"] for r in last),
            "yellow": sum(r["yellow"] for r in last),
            "red": sum(r["red"] for r in last),
        },
    }
    news._set_cached(cache_key, result)
    return result


# ---------------------------------------------------------------- main

def _ttl_for(state: str) -> int:
    return FINISHED_TTL if state == "finished" else UPCOMING_TTL if state == "upcoming" else LIVE_TTL


def _assemble(ev: dict, home_form, away_form) -> dict:
    state = _state_of(ev)
    goals, cards, subs = build_goals(ev), build_cards(ev), build_substitutions(ev)
    score = _parse_score(ev.get("event_final_result"))
    half = _parse_score(ev.get("event_halftime_result"))
    stats = [
        {"type": _s(r.get("type")), "home": _s(r.get("home")), "away": _s(r.get("away"))}
        for r in ev.get("statistics") or [] if isinstance(r, dict)
    ]
    return {
        "fixture_id": ev.get("event_key"),
        "state": _s(ev.get("event_status")),
        "live": state == "live",
        "finished": state == "finished",
        "upcoming": state == "upcoming",
        "home": {
            "name": _s(ev.get("event_home_team")), "key": ev.get("home_team_key"),
            "logo": ev.get("home_team_logo"), "formation": _s(ev.get("event_home_formation")),
        },
        "away": {
            "name": _s(ev.get("event_away_team")), "key": ev.get("away_team_key"),
            "logo": ev.get("away_team_logo"), "formation": _s(ev.get("event_away_formation")),
        },
        "score": {
            "home": score[0] if score else None,
            "away": score[1] if score else None,
            "halftime": f"{half[0]} - {half[1]}" if half else "",
        },
        "info": {
            "league": _s(ev.get("league_name")), "country": _s(ev.get("country_name")),
            "round": _s(ev.get("league_round")), "stadium": _s(ev.get("event_stadium")),
            "referee": _s(ev.get("event_referee")), "starting_at": _start_iso(ev),
        },
        "goals": goals,
        "cards": cards,
        "substitutions": subs,
        "card_totals": {
            side: {
                "yellow": sum(1 for c in cards if c["side"] == side and c["type"] == "yellow"),
                "red": sum(1 for c in cards if c["side"] == side and c["type"] == "red"),
            } for side in ("home", "away")
        },
        "lineups": {
            "home": _lineup_side(ev, "home", goals, cards, subs),
            "away": _lineup_side(ev, "away", goals, cards, subs),
        },
        "statistics": stats,
        "form": {"home": home_form, "away": away_form},
        "generated_at": int(time.time()),
    }


async def fetch_match_detail(fixture_id: int, home_key=None, away_key=None) -> dict | None:
    cache_key = f"allsports:detail:{fixture_id}"
    cached = news._get_cached(cache_key, ttl_seconds=FINISHED_TTL)
    if cached is not None and time.time() - cached.get("_cached_at", 0) < cached.get("_ttl", LIVE_TTL):
        return cached["data"]

    if home_key and away_key:
        # Team keys came from the tapped card: fetch stats and both forms in parallel.
        ev, home_form, away_form = await asyncio.gather(
            news.fetch_fixture_stats(fixture_id),
            team_form(home_key), team_form(away_key),
            return_exceptions=True,
        )
    else:
        ev = await news.fetch_fixture_stats(fixture_id)
        if not ev:
            return None
        home_form, away_form = await asyncio.gather(
            team_form(ev.get("home_team_key")), team_form(ev.get("away_team_key")),
            return_exceptions=True,
        )

    if isinstance(ev, Exception):
        raise ev
    if not ev:
        return None
    home_form = None if isinstance(home_form, Exception) else home_form
    away_form = None if isinstance(away_form, Exception) else away_form

    data = _assemble(ev, home_form, away_form)
    state = "live" if data["live"] else "finished" if data["finished"] else "upcoming" if data["upcoming"] else "live"
    news._set_cached(cache_key, {"_cached_at": time.time(), "_ttl": _ttl_for(state), "data": data})
    return data
