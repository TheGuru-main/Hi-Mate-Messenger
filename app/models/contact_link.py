import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ContactLink(Base):
    """A phonebook match: owner_uid has contact_uid's number saved."""
    __tablename__ = "contact_links"
    __table_args__ = (UniqueConstraint("owner_uid", "contact_uid", name="uq_contact_owner_contact"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_uid = Column(String, ForeignKey("users.uid"), nullable=False, index=True)
    contact_uid = Column(String, ForeignKey("users.uid"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
