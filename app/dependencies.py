from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from jose import JWTError

from app.database import get_db
from app.models.user import User
from app.services.auth import decode_token


async def get_current_user(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    uid = payload.get("sub")
    user = db.query(User).filter(User.uid == uid).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
