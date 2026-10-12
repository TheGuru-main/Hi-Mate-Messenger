"""Club profile aggregation: team info + squad (provider 'Teams' call) plus last-5 / next-15
(reuses match_detail.team_form). Football only for now.

Field names for the Teams call follow AllSportsAPI's football docs but are read defensively;
pass debug=True (route: ?debug=true) to see the provider's real keys and tighten the mapping.
"""

import asyncio
import time

from app.services import match_detail, match_search, news

PROFILE_FRESH = 6 * 3600
PROFILE_STALE = 48 * 3600
_GROUP_ORDER = ["Goalkeepers", "Defenders", "Midfielders", "Forwards", "Other"]


def _s(value) -> str:
    return "" if value is None else str(value).strip()


def _group(position: str) -> str:
    low = _s(position).lower()
    if "goal" in low or low in ("gk", "g"):
        return "Goalkeepers"
    if "def" in low or low in ("d", "cb", "lb", "rb"):
        return "Defenders"
    if "mid" in low or low in ("m", "cm", "dm", "am"):
        return "Midfielders"
    if "for" in low or "att" in low or "strik" in low or low in ("f", "st", "fw"):
        return "Forwards"
    return "Other"


def _num(value) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 999


def _squad(team: dict) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for p in team.get("players") or []:
        if not isinstance(p, dict):
            continue
        name = _s(p.get("player_name") or p.get("name"))
        if not name:
            continue
        position = p.get("player_type") or p.get("player_position")
        buckets.setdefault(_group(position), []).append({
            "player_id": p.get("player_key") or p.get("player_id"),
            "name": name,
            "number": _s(p.get("player_number")),
            "position": _s(position),
            "age": _s(p.get("player_age")),
            "country": _s(p.get("player_country")),
            "image": p.get("player_image") or None,
            "played": _s(p.get("player_match_played")),
            "goals": _s(p.get("player_goals")),
            "yellow": _s(p.get("player_yellow_cards")),
            "red": _s(p.get("player_red_cards")),
            "injured": _s(p.get("player_injured")).lower() in ("yes", "true", "1"),
        })
    return [
        {"position": g, "players": sorted(buckets[g], key=lambda r: (_num(r["number"]), r["name"]))}
        for g in _GROUP_ORDER if g in buckets
    ]


def _coaches(team: dict) -> list[str]:
    out = []
    for c in team.get("coaches") or []:
        if isinstance(c, dict):
            name = _s(c.get("coach_name") or c.get("coache") or c.get("name"))
            if name:
                out.append(name)
    return out


async def _load(team_key: str, name_hint: str, logo_hint: str) -> dict:
    team_res, form_res = await asyncio.gather(
        news._allsports_request({"met": "Teams", "teamId": team_key}),
        match_detail.team_form(team_key),
        return_exceptions=True,
    )
    team = team_res[0] if isinstance(team_res, list) and team_res and isinstance(team_res[0], dict) else {}
    form = None if isinstance(form_res, Exception) else form_res
    if not team and form is None:
        raise RuntimeError("provider returned nothing for this club")

    rows = ((form or {}).get("next") or []) + ((form or {}).get("last") or [])
    leagues = []
    for r in rows:
        if r.get("league") and r["league"] not in leagues:
            leagues.append(r["league"])
    squad = _squad(team)

    return {
        "team_key": team_key,
        "name": _s(team.get("team_name")) or name_hint,
        "logo": team.get("team_logo") or logo_hint or None,
        "league": leagues[0] if leagues else "",
        "leagues": leagues[:3],
        "country": _s(team.get("team_country") or team.get("country_name")),
        "coaches": _coaches(team),
        "squad": squad,
        "squad_size": sum(len(g["players"]) for g in squad),
        "form": form,
        "partial": not team,
        "generated_at": int(time.time()),
    }


async def fetch_club_profile(team_key, name_hint: str = "", logo_hint: str = "", debug: bool = False) -> dict:
    team_key = _s(team_key)
    if debug:
        data = await _load(team_key, name_hint, logo_hint)
        team_res = await news._allsports_request({"met": "Teams", "teamId": team_key})
        team = team_res[0] if team_res and isinstance(team_res[0], dict) else {}
        first = next((p for p in (team.get("players") or []) if isinstance(p, dict)), {})
        data["debug"] = {"team_keys": sorted(team.keys()), "player_keys": sorted(first.keys()),
                         "team_ok": bool(team), "form_ok": data["form"] is not None}
        return data

    key = f"club:{team_key}"
    data = await match_search._swr(key, lambda: _load(team_key, name_hint, logo_hint), PROFILE_FRESH, PROFILE_STALE)
    if data.get("partial"):
        # squad lookup failed: don't pin an incomplete profile for hours
        match_search._cache.pop(key, None)
    return data
