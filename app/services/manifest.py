"""Economy manifest access: latest database row merged over the code defaults (so new keys always exist)."""

import copy
import time

from sqlalchemy.orm import Session

from app.models.economy import EconomyManifest
from app.services.manifest_defaults import DEFAULT_MANIFEST

_cache = {"at": 0.0, "value": None}


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def ensure_seed(db: Session) -> None:
    if db.query(EconomyManifest.id).first() is None:
        db.add(EconomyManifest(version=1, config=copy.deepcopy(DEFAULT_MANIFEST), note="initial manifest"))
        db.commit()


def get_manifest(db: Session) -> dict:
    now = time.time()
    if _cache["value"] is not None and now - _cache["at"] < 60:
        return _cache["value"]
    row = db.query(EconomyManifest).order_by(EconomyManifest.version.desc()).first()
    cfg = _merge(DEFAULT_MANIFEST, row.config if row else {})
    cfg["version"] = row.version if row else 1
    _cache["value"], _cache["at"] = cfg, now
    return cfg
