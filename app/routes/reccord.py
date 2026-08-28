from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.reccord import ReccordEntry

router = APIRouter(prefix="/reccord", tags=["reccord-db"])


class ReccordCommit(BaseModel):
    name: str
    note: str


@router.post("/commit")
async def commit_note(
    payload: ReccordCommit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(ReccordEntry).filter(
        ReccordEntry.owner_uid == current_user.uid,
        ReccordEntry.name == payload.name,
    ).first()
    if existing:
        existing.note = payload.note
        db.commit()
        return {"status": "updated", "name": payload.name}

    entry = ReccordEntry(owner_uid=current_user.uid, name=payload.name, note=payload.note)
    db.add(entry)
    db.commit()
    return {"status": "committed", "name": payload.name}


@router.get("/lookup")
async def lookup_note(
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.query(ReccordEntry).filter(
        ReccordEntry.owner_uid == current_user.uid,
        ReccordEntry.name == name,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="No record under that name")
    return {"name": entry.name, "note": entry.note, "updated_at": entry.updated_at}


@router.get("/list")
async def list_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entries = db.query(ReccordEntry).filter(ReccordEntry.owner_uid == current_user.uid).all()
    return [{"name": e.name, "updated_at": e.updated_at} for e in entries]
