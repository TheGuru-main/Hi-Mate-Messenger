"""Economy manifest access: latest database row merged over the code defaults (so new keys always exist).
Rule changes ship as REVISIONS (see manifest_defaults.py): each becomes a NEW database row at startup."""

import copy
import time

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.economy import EconomyManifest
from app.services.manifest_defaults import DEFAULT_MANIFEST, REVISIONS

_cache = {"at": 0.0, "value": None}


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _latest(db: Session):
    return db.query(EconomyManifest).order_by(EconomyManifest.version.desc()).first()


def ensure_seed(db: Session) -> None:
    row = _latest(db)
    if row is None:
        db.add(EconomyManifest(version=1, config=copy.deepcopy(DEFAULT_MANIFEST), note="initial manifest"))
        db.commit()
        row = _latest(db)
    cfg = _merge(DEFAULT_MANIFEST, row.config)
    for rev in sorted(REVISIONS, key=lambda r: r["version"]):
        if rev["version"] <= row.version:
            continue
        cfg = _merge(cfg, rev["patch"])
        cfg["version"] = rev["version"]
        try:
            db.add(EconomyManifest(version=rev["version"], config=copy.deepcopy(cfg), note=rev["note"]))
            db.commit()
        except IntegrityError:
            db.rollback()
        row = _latest(db)
    _cache["value"] = None


def get_manifest(db: Session) -> dict:
    now = time.time()
    if _cache["value"] is not None and now - _cache["at"] < 60:
        return _cache["value"]
    row = _latest(db)
    cfg = _merge(DEFAULT_MANIFEST, row.config if row else {})
    cfg["version"] = row.version if row else 1
    _cache["value"], _cache["at"] = cfg, now
    return cfg
