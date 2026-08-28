import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class NewsPreference(Base):
    __tablename__ = "news_preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_uid = Column(String, ForeignKey("users.uid"), unique=True, nullable=False)
    topics = Column(ARRAY(String), default=list)          # e.g. ["general", "technology"]
    followed_leagues = Column(ARRAY(String), default=list)  # Sportmonk league IDs, as strings
    country = Column(String, default="ng")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
