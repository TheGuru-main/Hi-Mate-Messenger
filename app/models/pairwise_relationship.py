import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PairwiseRelationship(Base):
    """
    A relationship between two distinct entities (e.g. two users), filed
    at the letter-pair cell their first letters resolve to on the
    secondary Relationship Grid (see app/services/letter_pair_grid.py).
    This is separate from Klique (the main relationship system) — it's
    the secondary Country/Username/LGA-by-full-name-matching grid.
    """
    __tablename__ = "pairwise_relationships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_a_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    entity_b_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    scheme_id = Column(Integer, nullable=False)
    cell_code = Column(String, nullable=False, index=True)  # e.g. "AB", "GT"
    relationship_type = Column(String, nullable=True)  # freeform label, e.g. "referral", "collab"
    created_at = Column(DateTime, default=datetime.utcnow)
