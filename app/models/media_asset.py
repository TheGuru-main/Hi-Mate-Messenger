import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class MediaAsset(Base):
    """
    Tracks ownership of every uploaded media file, so delete/access
    control can actually enforce "only the uploader can delete this" —
    the storage layer itself (S3/R2) has no concept of app-level users.
    """
    __tablename__ = "media_assets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    media_ref = Column(String, unique=True, nullable=False, index=True)
    owner_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    content_type = Column(String, nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
