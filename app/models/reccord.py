import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ReccordEntry(Base):
    """
    Lightweight RECCORD DB integration — "Dropbox manner" note-keeping:
    deterministic drop/lookup by name, per the locked spec. This is the
    sync/backup path for the offline-first RECCORD DB client behavior.
    """
    __tablename__ = "reccord_entries"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    name = Column(String, nullable=False, index=True)  # the commit name, lookup key
    note = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
