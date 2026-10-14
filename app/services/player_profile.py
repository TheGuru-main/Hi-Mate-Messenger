"""Player profile: bio + current season + career by season, from AllSportsAPI 'Players' (football only).

Field names are read defensively; pass debug=True on the route (?debug=true) to see the provider's
real keys and tighten the mapping."""

import time

from app.services import news

FRESH = 6 * 3600
STALE = 48 * 3600
MAX_CACHE = 400
_cache: dict[str, tuple[float, dict]] = {}


def _s(value) -> str:
    return "" if value is None else str(value).strip()


def _i(value) -> int:
    try:
        return int(float(str(value).strip().replace(",", "")))
    except (TypeError, ValueError):
        return 0


def _rating(value):
    try:
        v = round(float(str(value).strip()), 2)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def _first(row: dict, *keys):
    for k in keys:
        if row.get(k) not in (None, ""):
            return row.get(k)
    return None


def _season_start(label: str) -> int:
    digits = "".join(ch if ch.isdigit() else " " for ch in label).split()
    return int(digits[0]) if digits else 0


def _rows(player: dict) -> list[dict]:
    out = []
    for r in player.get("stats") or []:
        if not isinstance(r, dict):
            continue
        out.append({
            "season": _s(_first(r, "season", "season_name")),
            "team": _s(_first(r, "team", "team_name", "club")),
            "apps": _i(_first(r, "rounds", "appearances", "matches", "games", "match_played", "played")),
            "minutes": _i(_first(r, "minutes", "minutes_played")),
            "goals": _i(_first(r, "goals")),
            "assists": _i(_first(r, "assists")),
            "yellow": _i(_first(r, "yellow_cards", "yellow")),
            "red": _i(_first(r, "red_cards", "red")),
            "rating": _rating(_first(r, "rating")),
        })
    return out


def _by_season(rows: list[dict]) -> list[dict]:
    seasons: dict[str, dict] = {}
    for r in rows:
        key = r["season"] or "-"
        s = seasons.setdefault(key, {
            "season": key, "teams": [], "apps": 0, "minutes": 0,
            "goals": 0, "assists": 0, "yellow": 0, "red": 0, "ratings": [],
        })
        if r["team"] and r["team"] not in s["teams"]:
            s["teams"].append(r["team"])
        for f in ("apps", "minutes", "goals", "assists", "yellow", "red"):
            s[f] += r[f]
        if r["rating"]:
            s["ratings"].append(r["rating"])
    out = []
    for s in seasons.values():
        ratings = s.pop("ratings")
        s["teams"] = " / ".join(s["teams"])
        s["rating"] = round(sum(ratings) / len(ratings), 2) if ratings else None
        out.append(s)
    out.sort(key=lambda s: _season_start(s["season"]), reverse=True)
    return out


def _normalize(player_key: str, p: dict) -> dict:
    career = _by_season(_rows(p))
    top = {
        "apps": _i(p.get("player_match_played")),
        "minutes": _i(_first(p, "player_minutes", "player_minutes_played")),
        "goals": _i(p.get("player_goals")),
        "assists": _i(p.get("player_assists")),
        "yellow": _i(p.get("player_yellow_cards")),
        "red": _i(p.get("player_red_cards")),
        "rating": _rating(p.get("player_rating")),
    }
    if any(top.values()):
        season = dict(top, label="Current season")
    elif career:
        cur = career[0]
        season = {k: cur[k] for k in ("apps", "minutes", "goals", "assists", "yellow", "red", "rating")}
        season["label"] = cur["season"]
    else:
        season = None
    totals = {f: sum(s[f] for s in career) for f in ("apps", "minutes", "goals", "assists", "yellow", "red")}
    return {
        "player_id": player_key,
        "name": _s(p.get("player_name")),
        "number": _s(p.get("player_number")),
        "position": _s(p.get("player_type")),
        "age": _s(p.get("player_age")),
        "birthdate": _s(p.get("player_birthdate")),
        "country": _s(p.get("player_country")),
        "image": p.get("player_image") or None,
        "team": _s(p.get("team_name")),
        "team_key": _s(p.get("team_key")),
        "captain": _s(p.get("player_is_captain")).lower() in ("yes", "true", "1"),
        "injured": _s(p.get("player_injured")).lower() in ("yes", "true", "1"),
        "season": season,
        "career": career,
        "totals": totals,
    }


def _remember(key: str, data: dict) -> None:
    if len(_cache) >= MAX_CACHE:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (time.time(), data)


async def get_profile(player_key: str, debug: bool = False) -> dict:
    now = time.time()
    hit = _cache.get(player_key)
    if hit and now - hit[0] < FRESH and not debug:
        return hit[1]
    try:
        res = await news._allsports_request({"met": "Players", "playerId": player_key})
    except Exception:
        if hit and now - hit[0] < STALE and not debug:
            return hit[1]
        raise
    player = res[0] if isinstance(res, list) and res and isinstance(res[0], dict) else None
    if not player:
        if hit and now - hit[0] < STALE and not debug:
            return hit[1]
        raise RuntimeError("provider returned nothing for this player")
    if debug:
        stats = player.get("stats")
        first = stats[0] if isinstance(stats, list) and stats and isinstance(stats[0], dict) else {}
        return {"raw_keys": sorted(player.keys()), "stats_keys": sorted(first.keys()), "raw": player}
    data = _normalize(player_key, player)
    _remember(player_key, data)
    return data
