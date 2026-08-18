import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class KliqueRequest(Base):
    """
    User-facing product language: "Klique". Internal table name/fields
    can stay conventional, per the locked naming rule.
    """
    __tablename__ = "klique_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    to_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    status = Column(String, default="pending")  # pending | accepted | declined
    created_at = Column(DateTime, default=datetime.utcnow)


class Follow(Base):
    __tablename__ = "follows"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    follower_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    followee_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Fan(Base):
    __tablename__ = "fans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fan_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    target_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Block(Base):
    __tablename__ = "blocks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blocker_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    blocked_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
