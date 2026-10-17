"""Portfolio items + work/talent credentials. Files come from /media/upload; ownership is re-checked here."""

import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.klique import KliqueRequest
from app.models.media_asset import MediaAsset
from app.models.portfolio import Credential, PortfolioItem
from app.models.user import User
from app.services import storage

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

MAX_ITEMS = 30
MAX_CREDENTIALS = 20
MAX_PINNED = 3
KINDS = {"video", "audio", "image", "document", "link", "code", "product"}
VISIBILITY = {"public", "kliques", "private"}
CT_PREFIX = {
    "video": ("video/",),
    "audio": ("audio/",),
    "image": ("image/",),
    "document": ("application/pdf", "application/vnd.openxmlformats"),
}
PROOF_PREFIX = ("image/", "application/pdf", "application/vnd.openxmlformats")

DEFAULT_TEMPLATE = {"kinds": ["image", "video", "document", "link"],
                    "hint": "Add photos, videos, documents or links that show your work."}
TALENT_TEMPLATES = {
    "S": {"kinds": ["video", "document", "link", "image"], "hint": "Add match highlight videos, a scouting CV and a link to your stats profile."},
    "M": {"kinds": ["audio", "video", "link", "document"], "hint": "Add song samples, live performance videos, a streaming link and lyric sheets."},
    "T": {"kinds": ["image", "video", "product"], "hint": "Add photos of finished outfits, a short work video and your price list."},
    "F": {"kinds": ["image", "video", "link"], "hint": "Add styled looks, lookbook videos and a link to your page."},
    "H": {"kinds": ["product", "image", "document"], "hint": "Add collections, lookbook PDFs and product photos."},
    "L": {"kinds": ["image", "video", "document"], "hint": "Add portfolio shots, a runway or reel video and a comp card."},
    "D": {"kinds": ["code", "video", "link", "document"], "hint": "Add repo links, a short demo video of your work, live app links and your CV."},
    "W": {"kinds": ["document", "link", "audio", "video"], "hint": "Add articles or scripts, links to published work and a reading or reel."},
    "C": {"kinds": ["image", "video", "product"], "hint": "Add photos and videos of finished pieces and your product list."},
    "P": {"kinds": ["image", "video", "link"], "hint": "Add your best shots, a behind-the-scenes reel and your gallery link."},
    "N": {"kinds": ["video", "audio", "document"], "hint": "Add broadcast clips, voice reels and your CV."},
    "K": {"kinds": ["audio", "link", "video"], "hint": "Add episode samples, your show link and a trailer video."},
}
BUSINESS_TEMPLATES = {
    "S": {"kinds": ["video", "image", "document"], "hint": "Add training or match footage, team photos and your credentials."},
    "R": {"kinds": ["product", "image", "video"], "hint": "Add your menu, dish photos and a short kitchen or venue video."},
    "B": {"kinds": ["image", "video", "product"], "hint": "Add before-and-after photos, styling videos and your service list."},
    "E": {"kinds": ["image", "video", "document"], "hint": "Add repair examples, short demo videos and your certificates."},
    "A": {"kinds": ["product", "image", "video"], "hint": "Add your collection, product photos and a lookbook video."},
    "D": {"kinds": ["document", "image", "video"], "hint": "Add your route experience and vehicle photos. Never upload ID or licence numbers."},
    "G": {"kinds": ["product", "image", "document"], "hint": "Add your product catalogue, shop photos and price list."},
    "M": {"kinds": ["product", "code", "link", "video"], "hint": "Add products, app or repo links and a demo video."},
    "H": {"kinds": ["image", "video", "document"], "hint": "Add finished jobs, short videos and your certificates."},
    "T": {"kinds": ["image", "video", "product"], "hint": "Add finished garments, a short work video and your price list."},
}


def _uuid(value: str):
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")


def _mutual(db: Session, a: str, b: str) -> bool:
    return db.query(KliqueRequest.id).filter(
        KliqueRequest.status == "accepted",
        or_(
            and_(KliqueRequest.from_uid == a, KliqueRequest.to_uid == b),
            and_(KliqueRequest.from_uid == b, KliqueRequest.to_uid == a),
        ),
    ).first() is not None


def _signed(ref):
    try:
        return storage.get_signed_url(ref)
    except Exception:
        return ref


def _clean_url(url):
    u = (url or "").strip()
    if not u:
        return None
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc or len(u) > 500:
        raise HTTPException(status_code=400, detail="Enter a full link starting with http:// or https://")
    return u


def _owned_asset(db: Session, ref: str, uid: str, prefixes=None):
    asset = db.query(MediaAsset).filter(MediaAsset.media_ref == ref, MediaAsset.owner_uid == uid).first()
    if not asset:
        raise HTTPException(status_code=400, detail="File not found. Upload it again.")
    ctype = (asset.content_type or "").lower()
    if prefixes and not any(ctype.startswith(p) for p in prefixes):
        raise HTTPException(status_code=400, detail="That file doesn't match the item type.")
    return asset


def _item_dict(i: PortfolioItem) -> dict:
    return {
        "id": str(i.id),
        "kind": i.kind,
        "title": i.title,
        "description": i.description,
        "category_type": i.category_type,
        "category_code": i.category_code,
        "url": i.link_url or (_signed(i.media_ref) if i.media_ref else None),
        "visibility": i.visibility,
        "pinned": bool(i.pinned),
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _cred_dict(c: Credential) -> dict:
    return {
        "id": str(c.id),
        "type": c.ctype,
        "title": c.title,
        "org": c.org,
        "start_year": c.start_year,
        "end_year": c.end_year,
        "description": c.description,
        "proof_url": _signed(c.proof_ref) if c.proof_ref else None,
        "status": c.status,
    }


def _cred_sort(c: Credential):
    year = c.end_year or c.start_year or 0
    present = 1 if (c.ctype == "work" and c.end_year is None) else 0
    return (-present, -year)


@router.get("/templates")
def templates(current_user: User = Depends(get_current_user)):
    return {
        "talent": TALENT_TEMPLATES,
        "business": BUSINESS_TEMPLATES,
        "default": DEFAULT_TEMPLATE,
        "mine": {"talent": current_user.interest, "business": current_user.business_role},
    }


@router.get("/user/{uid}")
def user_portfolio(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    own = uid == current_user.uid
    q = db.query(PortfolioItem).filter(PortfolioItem.owner_uid == uid)
    if not own:
        visible = ["public"]
        if _mutual(db, uid, current_user.uid):
            visible.append("kliques")
        q = q.filter(PortfolioItem.visibility.in_(visible))
    items = q.order_by(PortfolioItem.pinned.desc(), PortfolioItem.created_at.desc()).all()
    creds = sorted(db.query(Credential).filter(Credential.owner_uid == uid).all(), key=_cred_sort)
    return {
        "items": [_item_dict(i) for i in items],
        "credentials": [_cred_dict(c) for c in creds],
        "limits": {"items": MAX_ITEMS, "credentials": MAX_CREDENTIALS},
    }


class ItemIn(BaseModel):
    kind: str
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    category_type: str | None = None
    category_code: str | None = Field(default=None, max_length=2)
    media_ref: str | None = None
    link_url: str | None = None
    visibility: str = "public"


@router.post("/items")
def add_item(payload: ItemIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    kind = payload.kind.strip().lower()
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Unknown item type")
    if payload.visibility not in VISIBILITY:
        raise HTTPException(status_code=400, detail="Unknown visibility")
    if payload.category_type not in (None, "talent", "business"):
        raise HTTPException(status_code=400, detail="Unknown category type")
    code = (payload.category_code or "").strip().upper()[:1] or None
    link = _clean_url(payload.link_url)
    media_ref = (payload.media_ref or "").strip() or None
    if kind in ("link", "code") and not link:
        raise HTTPException(status_code=400, detail="Add the link.")
    if kind in CT_PREFIX and not media_ref and not link:
        raise HTTPException(status_code=400, detail="Add a file or a link.")
    if media_ref:
        _owned_asset(db, media_ref, uid, CT_PREFIX.get(kind))
    if db.query(PortfolioItem).filter(PortfolioItem.owner_uid == uid).count() >= MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"Portfolio is full ({MAX_ITEMS} items). Delete one first.")
    item = PortfolioItem(
        owner_uid=uid, kind=kind, title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        category_type=payload.category_type, category_code=code,
        media_ref=media_ref, link_url=link, visibility=payload.visibility,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_dict(item)


class ItemPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    visibility: str | None = None
    pinned: bool | None = None


@router.patch("/items/{item_id}")
def patch_item(item_id: str, payload: ItemPatch, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    item = db.query(PortfolioItem).filter(
        PortfolioItem.id == _uuid(item_id), PortfolioItem.owner_uid == current_user.uid).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.title is not None:
        item.title = payload.title.strip()
    if payload.description is not None:
        item.description = payload.description.strip() or None
    if payload.visibility is not None:
        if payload.visibility not in VISIBILITY:
            raise HTTPException(status_code=400, detail="Unknown visibility")
        item.visibility = payload.visibility
    if payload.pinned is not None:
        if payload.pinned and not item.pinned:
            pinned = db.query(PortfolioItem).filter(
                PortfolioItem.owner_uid == current_user.uid, PortfolioItem.pinned.is_(True)).count()
            if pinned >= MAX_PINNED:
                raise HTTPException(status_code=400, detail=f"You can pin up to {MAX_PINNED} items.")
        item.pinned = payload.pinned
    db.commit()
    return _item_dict(item)


@router.delete("/items/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(PortfolioItem).filter(
        PortfolioItem.id == _uuid(item_id), PortfolioItem.owner_uid == current_user.uid).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(item)
    db.commit()
    return {"deleted": True}


class CredIn(BaseModel):
    ctype: str
    title: str = Field(min_length=1, max_length=120)
    org: str | None = Field(default=None, max_length=120)
    start_year: int | None = Field(default=None, ge=1950, le=2100)
    end_year: int | None = Field(default=None, ge=1950, le=2100)
    description: str | None = Field(default=None, max_length=1000)
    proof_ref: str | None = None


@router.post("/credentials")
def add_credential(payload: CredIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    ctype = payload.ctype.strip().lower()
    if ctype not in ("work", "talent"):
        raise HTTPException(status_code=400, detail="Unknown credential type")
    if payload.start_year and payload.end_year and payload.end_year < payload.start_year:
        raise HTTPException(status_code=400, detail="End year can't be before the start year.")
    proof = (payload.proof_ref or "").strip() or None
    if proof:
        _owned_asset(db, proof, uid, PROOF_PREFIX)
    if db.query(Credential).filter(Credential.owner_uid == uid).count() >= MAX_CREDENTIALS:
        raise HTTPException(status_code=400, detail=f"You can add up to {MAX_CREDENTIALS} credentials.")
    cred = Credential(
        owner_uid=uid, ctype=ctype, title=payload.title.strip(),
        org=(payload.org or "").strip() or None,
        start_year=payload.start_year, end_year=payload.end_year,
        description=(payload.description or "").strip() or None,
        proof_ref=proof, status="self_declared",
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return _cred_dict(cred)


@router.delete("/credentials/{cred_id}")
def delete_credential(cred_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cred = db.query(Credential).filter(
        Credential.id == _uuid(cred_id), Credential.owner_uid == current_user.uid).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(cred)
    db.commit()
    return {"deleted": True}
