"""Player profile from AllSportsAPI (football only).

Verified response shapes:
- Players -> result[] of per-team records (a club and/or a national team) with flat stats;
  `stats` is null, so season-by-season history is NOT available from this provider.
- Teams -> players[] squad entries for that club with the same flat fields (no minutes, has birthdate).
Pass debug=True (route: ?debug=true) to see the raw provider records."""

import asyncio
import time

from app.services import news

FRESH = 6 * 3600
STALE = 48 * 3600
MAX_CACHE = 400
_cache: dict[str, tuple[float, dict]] = {}
_teams: dict[str, tuple[float, dict]] = {}


def _s(value) -> str:
    return "" if value is None else str(value).strip()


def _num(value):
    text = _s(value).replace(",", "")
    if not text:
        return None
    try:
        n = float(text)
    except ValueError:
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return int(n) if n == int(n) else round(n, 2)


def _int(value) -> int:
    n = _num(value)
    return int(n) if n is not None else 0


def _of(a, b):
    x, y = _num(a), _num(b)
    return f"{x} of {y}" if x is not None and y else None


def _first(rec: dict, *keys):
    for k in keys:
        if _s(rec.get(k)):
            return rec.get(k)
    return None


def _extras(rec: dict, gk: bool) -> list[dict]:
    items = []

    def add(label, value):
        if value is not None:
            items.append({"label": label, "value": value})

    if gk:
        add("Saves", _num(rec.get("player_saves")))
        add("Goals conceded", _num(rec.get("player_goals_conceded")))
        add("Clearances", _num(rec.get("player_clearances")))
    else:
        add("Shots", _num(rec.get("player_shots_total")))
        add("Key passes", _num(rec.get("player_key_passes")))
        add("Tackles", _num(rec.get("player_tackles")))
        add("Interceptions", _num(rec.get("player_interceptions")))
        add("Clearances", _num(rec.get("player_clearances")))
        add("Blocks", _num(rec.get("player_blocks")))
        add("Dribbles won", _of(rec.get("player_dribble_succ"), rec.get("player_dribble_attempts")))
        add("Duels won", _of(rec.get("player_duels_won"), rec.get("player_duels_total")))
    add("Accurate passes", _of(rec.get("player_passes_accuracy"), rec.get("player_passes")))
    scored, missed = _num(rec.get("player_pen_scored")), _num(rec.get("player_pen_missed"))
    if scored or missed:
        add("Penalties", f"{scored or 0} scored, {missed or 0} missed")
    return items


def _entry(rec: dict, kind: str) -> dict:
    gk = "goal" in _s(rec.get("player_type")).lower()
    return {
        "kind": kind,
        "team": _s(rec.get("team_name")),
        "team_key": _s(rec.get("team_key")),
        "apps": _int(rec.get("player_match_played")),
        "minutes": _num(rec.get("player_minutes")),
        "goals": _int(rec.get("player_goals")),
        "assists": _int(rec.get("player_assists")),
        "yellow": _int(rec.get("player_yellow_cards")),
        "red": _int(rec.get("player_red_cards")),
        "rating": _num(rec.get("player_rating")) or None,
        "extras": _extras(rec, gk),
    }


async def _team(team_key: str):
    now = time.time()
    hit = _teams.get(team_key)
    if hit and now - hit[0] < FRESH:
        return hit[1]
    try:
        res = await news._allsports_request({"met": "Teams", "teamId": team_key})
    except Exception:
        return hit[1] if hit and now - hit[0] < STALE else None
    team = res[0] if isinstance(res, list) and res and isinstance(res[0], dict) else None
    if team:
        if len(_teams) >= 60:
            _teams.pop(min(_teams, key=lambda k: _teams[k][0]), None)
        _teams[team_key] = (now, team)
    return team


def _remember(key: str, data: dict) -> None:
    if len(_cache) >= MAX_CACHE:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
    _cache[key] = (time.time(), data)


async def get_profile(player_key: str, team_key: str | None = None, debug: bool = False) -> dict:
    ck = f"{player_key}:{team_key or ''}"
    now = time.time()
    hit = _cache.get(ck)
    if hit and now - hit[0] < FRESH and not debug:
        return hit[1]

    players_res, team = await asyncio.gather(
        news._allsports_request({"met": "Players", "playerId": player_key}),
        _team(team_key) if team_key else asyncio.sleep(0),
        return_exceptions=True,
    )
    records = [r for r in players_res if isinstance(r, dict)] if isinstance(players_res, list) else []
    team = team if isinstance(team, dict) else None

    squad = None
    if team:
        for p in team.get("players") or []:
            if isinstance(p, dict) and _s(p.get("player_key")) == player_key:
                squad = p
                break

    if not records and not squad:
        if hit and now - hit[0] < STALE and not debug:
            return hit[1]
        raise RuntimeError("provider returned nothing for this player")

    if debug:
        return {"records": records, "squad_entry": squad, "team_name": team.get("team_name") if team else None}

    base, sq = (records[0] if records else {}), (squad or {})

    def pick(*keys):
        for src in (base, sq):
            v = _first(src, *keys)
            if v is not None:
                return v
        return None

    club_name = _s(team.get("team_name")) if team else ""
    club_key = _s(team_key) if team_key else ""

    entries = []
    for r in records:
        tk, tn = _s(r.get("team_key")), _s(r.get("team_name"))
        national = bool(tn) and tn.lower() == _s(r.get("player_country")).lower()
        kind = "club" if (club_key and tk == club_key) else ("national" if national else "club")
        entries.append(_entry(r, kind))
    if squad and club_key and not any(e["team_key"] == club_key for e in entries):
        merged = dict(squad)
        merged["team_name"] = club_name
        merged["team_key"] = club_key
        entries.insert(0, _entry(merged, "club"))
    entries.sort(key=lambda e: 0 if e["kind"] == "club" else 1)

    club_entry = next((e for e in entries if e["kind"] == "club"), None)
    totals = {f: sum((e[f] or 0) for e in entries) for f in ("apps", "minutes", "goals", "assists", "yellow", "red")}

    data = {
        "player_id": player_key,
        "name": _s(pick("player_name")),
        "number": _s(pick("player_number")),
        "position": _s(pick("player_type")),
        "age": _s(pick("player_age")),
        "birthdate": _s(pick("player_birthdate")),
        "country": _s(pick("player_country")),
        "image": pick("player_image"),
        "injured": _s(pick("player_injured")).lower() in ("yes", "true", "1"),
        "captain": _s(pick("player_is_captain")).lower() in ("yes", "true", "1"),
        "team": club_name or (club_entry["team"] if club_entry else ""),
        "team_key": club_key or (club_entry["team_key"] if club_entry else ""),
        "entries": entries,
        "totals": totals,
        "note": "Stats per team from the data provider. Season-by-season history isn't available.",
    }
    _remember(ck, data)
    return data
