"""Developer-only helpers. They work only for the phone numbers (digits, no +) listed in HIMATE_DEV_UIDS on the server.
With that setting empty every route here answers "not found". Remove before a public launch."""

import os
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services import wallet as wallet_service
from app.services.manifest import get_manifest

router = APIRouter(prefix="/dev", tags=["dev"])


def _is_dev(uid: str) -> bool:
    raw = os.getenv("HIMATE_DEV_UIDS", "")
    return uid in {x.strip().lstrip("+") for x in raw.split(",") if x.strip()}


@router.get("/status")
def dev_status(current_user: User = Depends(get_current_user)):
    if not _is_dev(current_user.uid):
        raise HTTPException(status_code=404, detail="Not found")
    return {"enabled": True}


class GrantIn(BaseModel):
    amount: int = 100000


@router.post("/grant")
def dev_grant(payload: GrantIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    if not _is_dev(uid):
        raise HTTPException(status_code=404, detail="Not found")
    amount = max(1, min(int(payload.amount), 1_000_000))
    m = get_manifest(db)
    wallet_service.credit(db, uid, amount, "dev_grant", f"dev_grant:{uid}:{int(time.time() * 1000)}",
                          hold_hours=0, manifest_version=m["version"], meta={"dev": True})
    db.commit()
    return {"granted": amount}
