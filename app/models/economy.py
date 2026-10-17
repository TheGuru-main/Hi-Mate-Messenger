import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Column, Date, DateTime, Float, Integer, JSON, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class EconomyManifest(Base):
    """Versioned economy rules. A change is a NEW row, never an edit, so every ledger line can name the rules it used."""

    __tablename__ = "economy_manifests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(Integer, unique=True, nullable=False)
    config = Column(JSON, nullable=False)
    note = Column(String, nullable=True)
    effective_from = Column(DateTime, default=datetime.utcnow, nullable=False)


class Wallet(Base):
    __tablename__ = "byflint_wallets"

    user_uid = Column(String, primary_key=True)
    balance = Column(BigInteger, default=0, nullable=False)   # spendable Byflints
    pending = Column(BigInteger, default=0, nullable=False)   # earned, still inside the review hold
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class LedgerEntry(Base):
    """Append-only money log. amount > 0 earns, < 0 spends. idem makes every operation safe to retry."""

    __tablename__ = "byflint_ledger"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_uid = Column(String, index=True, nullable=False)
    amount = Column(BigInteger, nullable=False)
    kind = Column(String, nullable=False)
    idem = Column(String, unique=True, nullable=False)
    status = Column(String, default="cleared", nullable=False)   # pending | cleared | cancelled
    release_at = Column(DateTime, nullable=True)
    manifest_version = Column(Integer, nullable=True)
    meta = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class SandclockState(Base):
    __tablename__ = "sandclock_states"

    user_uid = Column(String, primary_key=True)
    color = Column(Integer, default=1, nullable=False)        # 1..10
    fill = Column(Float, default=0.0, nullable=False)         # 0..100 inside the current colour
    level = Column(Integer, default=0, nullable=False)        # completed 10-colour cycles (badge only)
    last_active_day = Column(Date, nullable=True)
    decay_steps = Column(Integer, default=0, nullable=False)  # decay steps already applied this idle spell
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
