import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class LiveSession(Base):
    __tablename__ = "live_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    host_uid = Column(String, index=True, nullable=False)
    kind = Column(String, default="live", nullable=False)             # live | podcast
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category_type = Column(String, nullable=True)
    category_code = Column(String, nullable=True)
    visibility = Column(String, default="public", nullable=False)     # public | kliques
    status = Column(String, default="scheduled", nullable=False, index=True)   # scheduled | live | ended | cancelled
    scheduled_at = Column(DateTime, nullable=True, index=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    host_seen_at = Column(DateTime, nullable=True)
    peak_viewers = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class LiveMessage(Base):
    __tablename__ = "live_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    user_uid = Column(String, nullable=False)
    username = Column(String, nullable=True)
    kind = Column(String, default="chat", nullable=False)             # chat | gift | system
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class LiveGift(Base):
    __tablename__ = "live_gifts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    host_uid = Column(String, index=True, nullable=False)
    sender_uid = Column(String, index=True, nullable=False)
    gift_id = Column(String, nullable=False)
    cost = Column(Integer, nullable=False)
    weight = Column(Integer, nullable=False)
    request_id = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
