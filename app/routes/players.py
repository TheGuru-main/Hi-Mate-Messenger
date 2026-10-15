"""Follow a player (shown as 'Favorite players' on the profile)."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.favorite_player import FavoritePlayer
from app.models.user import User
from app.services import player_profile

router = APIRouter(prefix="/players", tags=["players"])

MAX_FAVORITE_PLAYERS = 100


class PlayerFollowIn(BaseModel):
    key: str
    name: str
    sport: str = "football"
    player_id: str | None = None
    team: str | None = None
    team_key: str | None = None
    number: str | None = None
    position: str | None = None


def _clean_key(key: str) -> str:
    k = (key or "").strip()
    if not k or len(k) > 200:
        raise HTTPException(status_code=400, detail="Invalid player")
    return k


def _dict(row) -> dict:
    return {
        "id": row.player_key,
        "name": row.player_name,
        "playerId": row.player_id,
        "team": row.team_name,
        "teamKey": row.team_key,
        "number": row.number or "",
        "position": row.position or "",
        "sport": row.sport,
    }


@router.get("/mine")
def my_players(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FavoritePlayer).filter_by(user_uid=current_user.uid).order_by(FavoritePlayer.created_at.desc()).all()
    return [_dict(r) for r in rows]


@router.get("/user/{uid}")
def user_players(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FavoritePlayer).filter_by(user_uid=uid).order_by(FavoritePlayer.created_at.desc()).all()
    return [_dict(r) for r in rows]


@router.post("/follow")
def follow_player(
    payload: PlayerFollowIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = _clean_key(payload.key)
    name = (payload.name or "").strip()[:120]
    if not name:
        raise HTTPException(status_code=400, detail="Invalid player")
    exists = db.query(FavoritePlayer).filter_by(user_uid=current_user.uid, sport=payload.sport, player_key=key).first()
    if not exists:
        if db.query(FavoritePlayer).filter_by(user_uid=current_user.uid).count() >= MAX_FAVORITE_PLAYERS:
            raise HTTPException(status_code=400, detail=f"You can follow up to {MAX_FAVORITE_PLAYERS} players")
        db.add(FavoritePlayer(
            user_uid=current_user.uid, sport=payload.sport, player_key=key,
            player_id=payload.player_id, player_name=name,
            team_name=payload.team, team_key=payload.team_key,
            number=payload.number, position=payload.position,
        ))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"following": True}


@router.delete("/follow")
def unfollow_player(
    key: str,
    sport: str = "football",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    k = _clean_key(key)
    db.query(FavoritePlayer).filter_by(user_uid=current_user.uid, sport=sport, player_key=k).delete()
    db.commit()
    return {"following": False}



@router.get("/{player_key}/profile")
async def player_profile_view(
    player_key: str,
    team_key: str | None = None,
    debug: bool = False,
    current_user: User = Depends(get_current_user),
):
    if not re.fullmatch(r"[0-9]{1,12}", player_key or ""):
        raise HTTPException(status_code=400, detail="Invalid player")
    if team_key and not re.fullmatch(r"[0-9]{1,12}", team_key):
        team_key = None
    try:
        return await player_profile.get_profile(player_key, team_key, debug)
    except Exception:
        raise HTTPException(status_code=502, detail="Player data unavailable right now")
