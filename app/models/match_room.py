import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class MatchRoom(Base):
    """
    Thin association between a Sportmonk fixture and its auto-created
    Hi-Mate group chat. The chat itself (banter) uses the existing
    Group/Message system unchanged — this table just links a live match
    to that group_id so the crawler/feed can surface it and so live
    score/event pushes know which room to notify.
    """
    __tablename__ = "match_rooms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fixture_id = Column(Integer, unique=True, nullable=False, index=True)
    group_id = Column(String, nullable=False)
    home_team = Column(String, nullable=True)
    away_team = Column(String, nullable=True)
    last_known_home_score = Column(Integer, default=0)
    last_known_away_score = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
