import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Integer, Boolean
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signup_token = Column(String, unique=True, nullable=False)
    phone = Column(String, nullable=False)
    otp_hash = Column(String, nullable=False)
    attempts = Column(Integer, default=0)
    verified = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Signup payload held here until OTP verification completes
    pending_username = Column(String, nullable=True)
    pending_password_hash = Column(String, nullable=True)
    pending_country = Column(String, nullable=True)
    pending_language = Column(String, nullable=True)
    pending_business_role = Column(String, nullable=True)
    pending_interest = Column(String, nullable=True)
    pending_marital_status = Column(String, nullable=True)
    pending_religion = Column(String, nullable=True)
    pending_feed_preferences = Column(String, nullable=True)
