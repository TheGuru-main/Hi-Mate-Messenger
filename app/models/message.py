import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Text, ARRAY
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Group(Base):
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(String, unique=True, nullable=False)  # generated: creator_uid + timestamp hash
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)  # intro/narration
    purpose = Column(String, nullable=True)

    # GSP placement for the group's own shared identity
    L = Column(Integer, nullable=False)
    S = Column(Integer, nullable=False)
    start_row = Column(Integer, nullable=False, index=True)

    member_uids = Column(ARRAY(String), default=list)
    pending_uids = Column(ARRAY(String), default=list)
    visibility = Column(String, default="private")  # "public" | "private"
    pending_uids = Column(ARRAY(String), default=list)
    visibility = Column(String, default="private")  # "public" | "private"
    created_by_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class GroupEvent(Base):
    __tablename__ = "group_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(String, ForeignKey("groups.group_id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(DateTime, nullable=False)
    created_by_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    sender_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    receiver_uid = Column(String, ForeignKey("users.uid"), nullable=True)   # for 1:1
    group_id = Column(String, ForeignKey("groups.group_id"), nullable=True)  # for group

    type = Column(String, nullable=False)  # text | image | video | voice | document
    content = Column(Text, nullable=True)
    media_ref = Column(String, nullable=True)
    reply_to = Column(UUID(as_uuid=True), nullable=True)

    # Which cell this message payload lives at (receiver's or group's start_row)
    cell_row = Column(Integer, nullable=False, index=True)

    identity_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
