from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.news_preference import NewsPreference
from app.schemas.settings import NewsPreferenceUpdate, PasswordChangeRequest, MenuItem
from app.services import auth as auth_service

router = APIRouter(prefix="/settings", tags=["settings"])

# Locked Side Dropdown structure, as data the frontend can render directly
# rather than hardcoding menu items client-side.
MENU_ITEMS: list[dict] = [
    {"key": "notifications", "label": "Notifications", "status": "available"},
    {"key": "reccord_db", "label": "RECCORD DB", "status": "available"},
    {"key": "quick_notes", "label": "Quick Notes", "status": "available"},
    {"key": "lominii_ai", "label": "LOMINII AI", "status": "coming_soon"},
    {"key": "settings", "label": "Settings", "status": "available"},
    {"key": "privacy", "label": "Privacy", "status": "available"},
    {"key": "language", "label": "Language", "status": "available"},
    {"key": "help_support", "label": "Help & Support", "status": "available"},
    {"key": "about", "label": "About", "status": "available"},
    {"key": "logout", "label": "Logout", "status": "available"},
]


@router.get("/menu", response_model=list[MenuItem])
async def get_settings_menu():
    return MENU_ITEMS


@router.get("/news-preferences")
async def get_news_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pref = db.query(NewsPreference).filter(NewsPreference.owner_uid == current_user.uid).first()
    if not pref:
        return {"topics": [], "followed_leagues": [], "country": "ng"}
    return {"topics": pref.topics, "followed_leagues": pref.followed_leagues, "country": pref.country}


@router.patch("/news-preferences")
async def update_news_preferences(
    payload: NewsPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pref = db.query(NewsPreference).filter(NewsPreference.owner_uid == current_user.uid).first()
    if not pref:
        pref = NewsPreference(owner_uid=current_user.uid, topics=[], followed_leagues=[], country="ng")
        db.add(pref)

    if payload.topics is not None:
        pref.topics = payload.topics
    if payload.followed_leagues is not None:
        pref.followed_leagues = payload.followed_leagues
    if payload.country is not None:
        pref.country = payload.country

    db.commit()
    return {"status": "updated"}


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not auth_service.verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    current_user.password_hash = auth_service.hash_password(payload.new_password)
    # Password change bumps identity_version too, matching the locked
    # rule that identity-affecting changes trigger versioning.
    current_user.identity_version += 1
    db.commit()
    return {"status": "password_changed"}


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """
    Stateless JWT — logout is primarily client-side (discard the token).
    This endpoint exists for the menu structure's sake and as a hook for
    future token-blacklisting if that becomes necessary.
    """
    return {"status": "logged_out"}
