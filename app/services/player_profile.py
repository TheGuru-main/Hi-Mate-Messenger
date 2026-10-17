"""Player profile (football only).

Sources:
- Computed club season: this season's team fixtures (lineups, substitutes, cards, goalscorers) aggregated by
  season_agg. The provider's Players/Teams stats carry no season label and are often blank or stale.
- Provider records (Players): per-team flat stats (club and/or national team). Used only when they hold data.
Pass debug=True (route: ?debug=true) to see the raw provider records."""

import asyncio
import datetime
import time

from app.services import news, season_agg

FRESH = 6 * 3600
STALE = 48 * 3600
SEASON_FRESH = 2 * 3600
PAST_FRESH = 30 * 86400
MAX_CACHE = 400
_cache: dict[str, tuple[float, dict]] = {}
_teams: dict[str, tuple[float, dict]] = {}
_seasons: dict[tuple[str, int], tuple[float, dict]] = {}


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


def season_start_year(today=None) -> int:
    today = today or datetime.date.today()
    return today.year if today.month >= 7 else today.year - 1


def season_label(year: int) -> str:
    return f"{year}/{str(year + 1)[2:]}"


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


async def team_season(team_key: str, year: int | None = None):
    today = datetime.date.today()
    cur = season_start_year(today)
    year = cur if year is None else year
    key = (team_key, year)
    now = time.time()
    fresh = SEASON_FRESH if year == cur else PAST_FRESH
    hit = _seasons.get(key)
    if hit and now - hit[0] < fresh:
        return hit[1]
    start = f"{year}-07-01"
    end = min(today, datetime.date(year + 1, 6, 30)).isoformat()
    try:
        events = await news._allsports_request(
            {"met": "Fixtures", "teamId": team_key, "from": start, "to": end})
    except Exception:
        return hit[1] if hit else None
    result = season_agg.aggregate(events if isinstance(events, list) else [], team_key)
    if len(_seasons) >= 40:
        _seasons.pop(min(_seasons, key=lambda k: _seasons[k][0]), None)
    # an empty result is only remembered briefly, so a provider hiccup can't stick
    stamp = now if result["team_matches"] else now - fresh + 600
    _seasons[key] = (stamp, result)
    return result


def _remember(key: str, data: dict) -> None:
    if len(_cache) >= MAX_CACHE:
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
    _cache[key] = (time.time(), data)


async def get_profile(player_key: str, team_key: str | None = None, debug: bool = False) -> dict:
    ck = f"{player_key}:{team_key or ''}"
    now = time.time()
    hit = _cache.get(ck)
    if hit and now - hit[0] < SEASON_FRESH and not debug:
        return hit[1]

    club_key = _s(team_key) if team_key else ""
    players_res, team, season = await asyncio.gather(
        news._allsports_request({"met": "Players", "playerId": player_key}),
        _team(club_key) if club_key else asyncio.sleep(0),
        team_season(club_key) if club_key else asyncio.sleep(0),
        return_exceptions=True,
    )
    records = [r for r in players_res if isinstance(r, dict)] if isinstance(players_res, list) else []
    team = team if isinstance(team, dict) else None
    season = season if isinstance(season, dict) else None

    squad = None
    if team:
        for p in team.get("players") or []:
            if isinstance(p, dict) and _s(p.get("player_key")) == player_key:
                squad = p
                break

    if not records and not squad and not (season and season["players"].get(player_key)):
        if hit and now - hit[0] < STALE and not debug:
            return hit[1]
        raise RuntimeError("provider returned nothing for this player")

    if debug:
        return {"records": records, "squad_entry": squad,
                "season_matches": season["matches"] if season else None,
                "season_player": season["players"].get(player_key) if season else None}

    base, sq = (records[0] if records else {}), (squad or {})

    def pick(*keys):
        for src in (base, sq):
            v = _first(src, *keys)
            if v is not None:
                return v
        return None

    club_name = _s(team.get("team_name")) if team else ""
    if not club_name:
        for r in records:
            if club_key and _s(r.get("team_key")) == club_key and _s(r.get("team_name")):
                club_name = _s(r.get("team_name"))
                break

    cur_year = season_start_year()
    has_computed = bool(season and season.get("team_matches"))
    entries = []

    if has_computed:
        p = season["players"].get(player_key) or {}
        note = f"Computed from {season['matches']} official matches with lineups"
        if season["no_lineup"]:
            note += f" ({season['no_lineup']} more without lineup data)"
        entries.append({
            "kind": "club", "source": "fixtures",
            "title": f"Club · {season_label(cur_year)}",
            "team": club_name, "team_key": club_key,
            "apps": p.get("apps", 0), "minutes": p.get("minutes", 0), "goals": p.get("goals", 0),
            "assists": p.get("assists", 0), "yellow": p.get("yellow", 0), "red": p.get("red", 0),
            "rating": None,
            "extras": [{"label": "Starts", "value": p.get("starts", 0)},
                       {"label": "Team matches", "value": season["team_matches"]}],
            "note": note + ". Friendlies excluded.",
        })

    seen = set()
    for r in records:
        tk, tn = _s(r.get("team_key")), _s(r.get("team_name"))
        national = bool(tn) and tn.lower() == _s(r.get("player_country")).lower()
        kind = "club" if (club_key and tk == club_key) else ("national" if national else "club")
        if kind == "club" and has_computed:
            continue
        e = _entry(r, kind)
        sig = (e["team_key"], e["apps"], e["minutes"], e["goals"], e["assists"], e["yellow"], e["red"])
        if not any(sig[1:]) or sig in seen:
            continue
        seen.add(sig)
        e["source"] = "provider"
        e["title"] = ("National team · provider data (season not specified)" if kind == "national"
                      else "Club · provider data (season not specified)")
        entries.append(e)

    if squad and club_key and not has_computed and not any(e["kind"] == "club" for e in entries):
        merged = dict(squad)
        merged["team_name"] = club_name
        merged["team_key"] = club_key
        e = _entry(merged, "club")
        if any((e["apps"], e["goals"], e["assists"], e["yellow"], e["red"])):
            e["source"] = "provider"
            e["title"] = "Club · provider data (season not specified)"
            entries.insert(0, e)

    entries.sort(key=lambda e: (0 if e["source"] == "fixtures" else 1, 0 if e["kind"] == "club" else 1))

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
        "team": club_name,
        "team_key": club_key,
        "season": season_label(cur_year),
        "entries": entries,
        "note": "Season stats are computed from official matches with lineup data. Friendlies are excluded.",
    }
    _remember(ck, data)
    return data


async def get_career(player_key: str, team_key: str, seasons: int = 3) -> dict:
    cur = season_start_year()
    years = [cur - i for i in range(0, seasons + 1)]
    results = await asyncio.gather(*[team_season(team_key, y) for y in years], return_exceptions=True)
    rows = []
    for y, res in zip(years, results):
        if isinstance(res, Exception) or not isinstance(res, dict) or not res.get("team_matches"):
            rows.append({"season": season_label(y), "ok": False})
            continue
        p = res["players"].get(player_key) or {}
        rows.append({
            "season": season_label(y), "ok": True,
            "team_matches": res["team_matches"], "lineup_matches": res["matches"],
            "apps": p.get("apps", 0), "starts": p.get("starts", 0), "minutes": p.get("minutes", 0),
            "goals": p.get("goals", 0), "assists": p.get("assists", 0),
            "yellow": p.get("yellow", 0), "red": p.get("red", 0),
        })
    return {"team_key": team_key, "rows": rows,
            "note": "Seasons at the player's current club only, computed from official matches with lineup data."}
