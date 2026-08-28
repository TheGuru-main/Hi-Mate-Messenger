import os
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException

from app.dependencies import get_current_user
from app.models.user import User

router = APIRouter(prefix="/media", tags=["media"])

# Render's local disk is EPHEMERAL — files here are wiped on every deploy
# and don't survive across multiple instances. This works for early
# development/testing only. Before real users depend on media persisting,
# swap this for real object storage (S3, Cloudflare R2, Backblaze B2) —
# the upload_file() function is the only thing that needs to change;
# every route that stores a media_ref string keeps working unchanged.
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".mp4", ".mov", ".mp3", ".m4a", ".pdf", ".docx"}
MAX_FILE_SIZE_MB = 25


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {ext} not allowed")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_FILE_SIZE_MB}MB limit")

    media_ref = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, media_ref)
    with open(filepath, "wb") as f:
        f.write(contents)

    return {"media_ref": media_ref, "size_bytes": len(contents)}
