import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


DURATION_SECONDS = {
    "1h": 3600,
    "24h": 86400,
    "3d": 259200,
    "1w": 604800,
}


class Status(Base):
    __tablename__ = "statuses"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    author_uid = Column(
        String,
        ForeignKey("users.uid"),
        nullable=False,
        index=True,
    )

    content = Column(Text, nullable=True)

    # Legacy single-media field.
    media_ref = Column(
        String,
        nullable=True,
    )

    # Canonical multi-media field.
    # Stored as comma-joined media refs, matching the existing
    # Posts multi-media implementation.
    media_refs = Column(
        Text,
        nullable=True,
    )

    visibility = Column(
        String,
        nullable=False,
    )  # "global" | "targeted"

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        index=True,
    )

    expires_at = Column(
        DateTime,
        nullable=False,
        index=True,
    )


class StatusRecipient(Base):
    """
    Only populated for visibility='targeted' —
    one row per chosen recipient.
    """

    __tablename__ = "status_recipients"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    status_id = Column(
        UUID(as_uuid=True),
        ForeignKey("statuses.id"),
        nullable=False,
        index=True,
    )

    recipient_uid = Column(
        String,
        ForeignKey("users.uid"),
        nullable=False,
        index=True,
    )
