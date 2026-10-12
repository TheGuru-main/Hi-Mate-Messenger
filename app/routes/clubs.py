"""Follow a club (shown as 'Favorite clubs' on the profile) and view a club profile."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.favorite_club import FavoriteClub
from app.models.user import User
from app.services import club_profile

router = APIRouter(prefix="/clubs", tags=["clubs"])

SUPPORTED_SPORTS = {"football"}
MAX_FAVORITE_CLUBS = 30


class ClubFollowIn(BaseModel):
    name: str = ""
    logo: str | None = None


def _check(sport: str, team_key: str) -> str:
    if sport not in SUPPORTED_SPORTS:
        raise HTTPException(status_code=404, detail="Unsupported sport")
    key = (team_key or "").strip()
    if not key or len(key) > 40:
        raise HTTPException(status_code=400, detail="Invalid club")
    return key


def _club_dict(row) -> dict:
    return {"team_key": row.team_key, "name": row.team_name, "logo": row.team_logo, "sport": row.sport}


def _followers(db: Session, sport: str, team_key: str) -> int:
    return db.query(FavoriteClub).filter_by(sport=sport, team_key=team_key).count()


# Static paths first, so "/mine" and "/user/..." are never read as a team key.

@router.get("/mine")
def my_clubs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FavoriteClub).filter_by(user_uid=current_user.uid).order_by(FavoriteClub.created_at.desc()).all()
    return [_club_dict(r) for r in rows]


@router.get("/user/{uid}")
def user_clubs(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FavoriteClub).filter_by(user_uid=uid).order_by(FavoriteClub.created_at.desc()).all()
    return [_club_dict(r) for r in rows]


@router.get("/{team_key}")
async def club_profile_view(
    team_key: str,
    sport: str = "football",
    name: str = "",
    logo: str = "",
    debug: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = _check(sport, team_key)
    try:
        data = await club_profile.fetch_club_profile(key, name, logo, debug)
    except Exception:
        raise HTTPException(status_code=502, detail="Club data unavailable right now")
    data = dict(data)
    data["following"] = db.query(FavoriteClub).filter_by(user_uid=current_user.uid, sport=sport, team_key=key).first() is not None
    data["followers"] = _followers(db, sport, key)
    return data


@router.post("/{team_key}/follow")
def follow_club(
    team_key: str,
    payload: ClubFollowIn,
    sport: str = "football",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = _check(sport, team_key)
    exists = db.query(FavoriteClub).filter_by(user_uid=current_user.uid, sport=sport, team_key=key).first()
    if not exists:
        if db.query(FavoriteClub).filter_by(user_uid=current_user.uid).count() >= MAX_FAVORITE_CLUBS:
            raise HTTPException(status_code=400, detail=f"You can follow up to {MAX_FAVORITE_CLUBS} clubs")
        db.add(FavoriteClub(
            user_uid=current_user.uid, sport=sport, team_key=key,
            team_name=(payload.name or "").strip() or "Club", team_logo=payload.logo,
        ))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"following": True, "followers": _followers(db, sport, key)}


@router.delete("/{team_key}/follow")
def unfollow_club(
    team_key: str,
    sport: str = "football",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    key = _check(sport, team_key)
    db.query(FavoriteClub).filter_by(user_uid=current_user.uid, sport=sport, team_key=key).delete()
    db.commit()
    return {"following": False, "followers": _followers(db, sport, key)}
