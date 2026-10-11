import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.message import Group
from app.models.match_room import MatchRoom
from app.services import news, placement
from app.services import match_search
from app.services import match_detail as match_detail_service

router = APIRouter(prefix="/matches", tags=["match-rooms"])


@router.get("/live")
async def list_live_matches(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    The scoreboard list — always-visible compact summary per match.
    Each entry flags whether a room already exists (has_room), so the
    frontend knows whether tapping it opens an existing chat or creates one.
    """
    try:
        live = await news.fetch_live_fixtures()
    except Exception:
        raise HTTPException(status_code=502, detail="Live scores provider unavailable. Check ALLSPORTS_BASE_URL and ALLSPORTS_API_KEY.")
    fixture_ids = [m["fixture_id"] for m in live if m.get("fixture_id")]
    existing_rooms = {
        r.fixture_id: r.group_id
        for r in db.query(MatchRoom).filter(MatchRoom.fixture_id.in_(fixture_ids)).all()
    } if fixture_ids else {}

    for m in live:
        m["has_room"] = m["fixture_id"] in existing_rooms
        m["group_id"] = existing_rooms.get(m["fixture_id"])
    return live


@router.get("/upcoming")
async def list_upcoming_matches(
    hours: int = 34,
    country: str | None = None,
    timezone_name: str = "UTC",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        upcoming = await news.fetch_upcoming_fixtures(
            hours=hours,
            display_timezone=timezone_name,
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Sports data provider unavailable")
    ids = [m["fixture_id"] for m in upcoming if m.get("fixture_id")]
    rooms = {
        r.fixture_id: r.group_id
        for r in db.query(MatchRoom).filter(MatchRoom.fixture_id.in_(ids)).all()
    } if ids else {}
    if country:
        needle = country.strip().lower()
        upcoming = [
            m for m in upcoming
            if needle in (m.get("country") or "").lower()
            or needle in (m.get("league") or "").lower()
        ]
    for m in upcoming:
        m["has_room"] = m["fixture_id"] in rooms
        m["group_id"] = rooms.get(m["fixture_id"])
    return upcoming



@router.get("/search-legacy")
async def search_matches(
    q: str,
    current_user: User = Depends(get_current_user),
):
    """Direct LiveSports club-name search."""
    query = q.strip()

    if not query:
        return []

    try:
        return await news.search_live_sports(query)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Sports search provider unavailable",
        )


@router.post("/{fixture_id}/join")
async def join_match_room(
    fixture_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Auto-creates the match's room chat on first join (using the existing
    Group placement mechanism, unchanged), then adds the requesting user
    as a member. Idempotent — safe to call every time a user taps into a match.
    """
    room = db.query(MatchRoom).filter(MatchRoom.fixture_id == fixture_id).first()

    if not room:
        live = await news.fetch_live_fixtures()
        live = live + await news.fetch_upcoming_fixtures()
        match = next((m for m in live if m.get("fixture_id") == fixture_id), None)
        if not match:
            match = await match_search.find_recent_fixture(fixture_id)
        if not match:
            raise HTTPException(status_code=404, detail="Match is no longer available")

        room_name = match.get("name") or f"Match {fixture_id}"
        raw = f"match-{fixture_id}-{time.time()}"
        group_id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        p = placement.compute_placement(room_name, group_id)

        group = Group(
            group_id=group_id, name=room_name, L=p["L"], S=p["S"], start_row=p["start_row"],
            member_uids=[current_user.uid], created_by_uid=current_user.uid,
        )
        db.add(group)

        room = MatchRoom(
            fixture_id=fixture_id, group_id=group_id,
            home_team=match.get("home_team"), away_team=match.get("away_team"),
            last_known_home_score=match.get("home_score") or 0,
            last_known_away_score=match.get("away_score") or 0,
        )
        db.add(room)
        db.commit()
        return {"group_id": group_id, "created": True}

    # Room exists — add this user as a member if not already
    group = db.query(Group).filter(Group.group_id == room.group_id).first()
    if group and current_user.uid not in group.member_uids:
        group.member_uids = group.member_uids + [current_user.uid]
        db.commit()

    return {"group_id": room.group_id, "created": False}


@router.get("/{fixture_id}/stats")
async def get_match_stats(fixture_id: int, current_user: User = Depends(get_current_user)):
    """
    The stats/live-view FOLD — separate from the room chat entirely.
    Not stored as messages; fetched fresh (short-cached) from AllSportsAPI.
    """
    stats = await news.fetch_fixture_stats(fixture_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Stats not available for this fixture")
    return stats

@router.get("/{fixture_id}/detail")
async def match_detail(
    fixture_id: int,
    home_key: str | None = None,
    away_key: str | None = None,
    current_user: User = Depends(get_current_user),
):
    """Goals, cards, subs, lineups, stats, last-5 and next-15 for one match, in one call."""
    try:
        data = await match_detail_service.fetch_match_detail(fixture_id, home_key, away_key)
    except Exception:
        raise HTTPException(status_code=502, detail="Sports data provider unavailable")
    if not data:
        raise HTTPException(status_code=404, detail="Match detail not available")
    return data


@router.get("/search")
async def search_matches_scoped(
    q: str = "",
    scope: str = "all",
    days: int = 3,
    timezone_name: str = "UTC",
    current_user: User = Depends(get_current_user),
):
    """Scoped LiveSports search: scope = all | live | upcoming | past (last `days` days)."""
    try:
        return await match_search.search(q.strip(), scope, days, timezone_name)
    except Exception:
        raise HTTPException(status_code=502, detail="Sports search provider unavailable")


@router.get("/recent")
async def recent_matches(
    days: int = 3,
    timezone_name: str = "UTC",
    current_user: User = Depends(get_current_user),
):
    """Finished matches from the last `days` days (max 7), newest first."""
    try:
        items = await match_search.fetch_recent_fixtures(days, timezone_name)
    except Exception:
        raise HTTPException(status_code=502, detail="Sports data provider unavailable")
    return [dict(m, scope="past") for m in items]
