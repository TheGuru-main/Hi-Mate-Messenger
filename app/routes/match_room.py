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
        raise HTTPException(status_code=502, detail="Live scores provider unavailable. Check SPORTMONK_BASE_URL and the API key.")
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
async def list_upcoming_matches(hours: int = 34, country: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        upcoming = await news.fetch_upcoming_fixtures(hours=hours)
    except Exception:
        raise HTTPException(status_code=502, detail="Sports data provider unavailable")
    ids = [m["fixture_id"] for m in upcoming if m.get("fixture_id")]
    rooms = {
        r.fixture_id: r.group_id
        for r in db.query(MatchRoom).filter(MatchRoom.fixture_id.in_(ids)).all()
    } if ids else {}
    if country:
        upcoming = [m for m in upcoming if (m.get("league") or "").lower().find(country.lower()) != -1]
    for m in upcoming:
        m["has_room"] = m["fixture_id"] in rooms
        m["group_id"] = rooms.get(m["fixture_id"])
    return upcoming



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
            raise HTTPException(status_code=404, detail="Match not currently live")

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
    Not stored as messages; fetched fresh (short-cached) from Sportmonk.
    """
    stats = await news.fetch_fixture_stats(fixture_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Stats not available for this fixture")
    return stats