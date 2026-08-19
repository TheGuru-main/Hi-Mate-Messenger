import uuid
from datetime import datetime

from sqlalchemy import Column, String, Integer, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Identity
    uid = Column(String, unique=True, nullable=False, index=True)  # phone, "+" stripped
    phone = Column(String, unique=True, nullable=False)             # stored WITH "+"
    username = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)

    # Location / language
    country = Column(String, nullable=True)
    region = Column(String, nullable=True)
    locality = Column(String, nullable=True)
    language = Column(String, nullable=True)

    # Simplified business layer (Talent/Byflint ecosystem parked)
    business_role = Column(String, nullable=True)  # single-letter field code
    interest = Column(String, nullable=True)

    # Optional profile fields
    marital_status = Column(String, nullable=True)
    religion = Column(String, nullable=True)
    feed_preferences = Column(String, nullable=True)  # comma-separated for simplicity; move to array/table later

    # GSP placement (always computed server-side — never trust client input)
    L = Column(Integer, nullable=False)
    S = Column(Integer, nullable=False)
    C = Column(Integer, nullable=False)
    start_row = Column(Integer, nullable=False, index=True)

    # Versioning
    identity_version = Column(Integer, default=1, nullable=False)
    app_version = Column(String, default="1.0.0.1")

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
