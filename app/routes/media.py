import os

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.media_asset import MediaAsset
from app.services import storage

router = APIRouter(prefix="/media", tags=["media"])

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".mp4", ".mov", ".mp3", ".m4a", ".webm", ".pdf", ".docx"}
CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webm": "audio/webm",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_FILE_SIZE_MB = 25


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Uploads to a PRIVATE bucket (no public-bucket billing gate). Returns
    a signed URL valid for 7 days — the client should re-fetch a fresh
    one via GET /media/{media_ref}/url once it expires, rather than
    caching the URL long-term.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_FILE_SIZE_MB}MB limit")

    if not storage.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Media storage is not configured yet — set STORAGE_* env vars in Render.",
        )

    content_type = CONTENT_TYPES.get(ext, "application/octet-stream")
    media_ref = storage.upload_bytes(contents, ext, content_type)
    signed_url = storage.get_signed_url(media_ref)

    asset = MediaAsset(
        media_ref=media_ref,
        owner_uid=current_user.uid,
        content_type=content_type,
        size_bytes=len(contents),
    )
    db.add(asset)
    db.commit()

    return {"media_ref": media_ref, "url": signed_url, "size_bytes": len(contents)}


@router.get("/{media_ref}/url")
async def get_fresh_url(
    media_ref: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-signs a URL for an existing file — call this once the URL from
    upload time (or a previous call here) has expired."""
    asset = db.query(MediaAsset).filter(MediaAsset.media_ref == media_ref).first()
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    return {"media_ref": media_ref, "url": storage.get_signed_url(media_ref)}


@router.delete("/{media_ref}")
async def delete_file(
    media_ref: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(MediaAsset).filter(MediaAsset.media_ref == media_ref).first()
    if not asset:
        raise HTTPException(status_code=404, detail="File not found")
    if asset.owner_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="You can only delete your own uploads")

    storage.delete_object(media_ref)
    db.delete(asset)
    db.commit()
    return {"status": "deleted"}
