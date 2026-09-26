import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_uid = Column(String, ForeignKey("users.uid"), nullable=False, index=True)
    actor_uid = Column(String, ForeignKey("users.uid"), nullable=True)
    type = Column(String, nullable=False)  # "klique_request" | "klique_accepted" | "follow"
    message = Column(String, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
