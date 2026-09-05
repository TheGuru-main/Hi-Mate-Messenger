"""
Background poller — checks all active MatchRooms for score changes and
pushes a "goal" event into the room's chat via the existing WebSocket
manager, whenever a score changes since the last check. Runs as an
asyncio background task inside the FastAPI app (works on Render since
it's a persistent web service, not serverless — would need a real
scheduler/cron if this ever moves to a serverless host).
"""
import asyncio

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.match_room import MatchRoom
from app.services import news
from app.sockets.manager import manager

POLL_INTERVAL_SECONDS = 30


async def poll_live_matches():
    while True:
        try:
            await _check_active_rooms()
        except Exception as e:
            # Never let a bad API response or transient error kill the
            # background loop — log and keep polling.
            print(f"[match poller] error: {e}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _check_active_rooms():
    db: Session = SessionLocal()
    try:
        rooms = db.query(MatchRoom).all()
        if not rooms:
            return

        live = await news.fetch_live_fixtures()
        live_by_id = {m["fixture_id"]: m for m in live if m.get("fixture_id")}

        for room in rooms:
            match = live_by_id.get(room.fixture_id)
            if not match:
                continue  # match ended or not currently live — leave the room's last known score as-is

            new_home = match.get("home_score") or 0
            new_away = match.get("away_score") or 0

            if new_home != room.last_known_home_score or new_away != room.last_known_away_score:
                await _push_goal_event(room, match, new_home, new_away)
                room.last_known_home_score = new_home
                room.last_known_away_score = new_away
                db.commit()
    finally:
        db.close()


async def _push_goal_event(room: MatchRoom, match: dict, new_home: int, new_away: int):
    scorer_side = "home" if new_home > room.last_known_home_score else "away"
    team_name = room.home_team if scorer_side == "home" else room.away_team

    event_payload = {
        "type": "match_event",
        "event": "goal",
        "fixture_id": room.fixture_id,
        "team": team_name,
        "score": f"{new_home}-{new_away}",
        "minute": match.get("minute"),
    }

    # Push to every member currently connected — the group's member_uids
    # live on the Group record, but we only need the group_id here since
    # send_to_group needs the member list; fetch it fresh to stay accurate.
    from app.models.message import Group  # local import avoids a circular import at module load time
    db: Session = SessionLocal()
    try:
        group = db.query(Group).filter(Group.group_id == room.group_id).first()
        if group:
            await manager.send_to_group(group.member_uids, event_payload)
    finally:
        db.close()
