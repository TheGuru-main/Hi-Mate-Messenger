from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.edu_journal import EduJournalEntry

router = APIRouter(prefix="/edu", tags=["edu"])


class JournalEntryCreate(BaseModel):
    content: str


@router.post("/journal")
async def create_journal_entry(payload: JournalEntryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    entry = EduJournalEntry(uid=current_user.uid, content=payload.content)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": str(entry.id), "content": entry.content, "created_at": entry.created_at.isoformat()}


@router.get("/journal")
async def list_journal_entries(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    entries = db.query(EduJournalEntry).filter(EduJournalEntry.uid == current_user.uid).order_by(EduJournalEntry.created_at.desc()).all()
    return [{"id": str(e.id), "content": e.content, "created_at": e.created_at.isoformat()} for e in entries]
