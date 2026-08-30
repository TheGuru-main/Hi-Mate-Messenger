"""
Real cloud object storage for user media — S3-compatible API (Backblaze
B2, or AWS S3/Cloudflare R2 if you switch later — same code either way).

IMPORTANT: the bucket stays PRIVATE. Making a bucket "Public" on
Backblaze (and similarly on other providers) gates CDN/bandwidth
delivery behind a billing requirement, which needs a card we don't have.
Private storage + backend-generated SIGNED URLS avoids that entirely,
and is arguably better practice anyway — nothing is guessable/public,
access only happens through a URL we explicitly generate and expire.

Backblaze B2 setup (no card needed for any of this):
  1. Sign up at backblaze.com — B2 Cloud Storage, no card required
  2. Create a bucket, leave it PRIVATE (default)
  3. Application Keys -> Add a New Application Key -> Read+Write, scoped
     to your bucket
  4. Set these env vars in Render:
       STORAGE_ENDPOINT_URL   = https://s3.<region>.backblazeb2.com
       STORAGE_ACCESS_KEY_ID  = <your keyID>
       STORAGE_SECRET_KEY     = <your applicationKey>
       STORAGE_BUCKET_NAME    = <your bucket name>
     (STORAGE_PUBLIC_URL_BASE is no longer needed — signed URLs are
     generated per-request instead of a static public base.)
"""
import uuid

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import get_settings

settings = get_settings()

_client = None

# Signed URL lifetime — how long a generated link stays valid before it
# needs to be regenerated. 7 days is the practical max for SigV4
# presigned URLs on most S3-compatible providers.
DEFAULT_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.STORAGE_ENDPOINT_URL or None,
            aws_access_key_id=settings.STORAGE_ACCESS_KEY_ID,
            aws_secret_access_key=settings.STORAGE_SECRET_KEY,
            config=BotoConfig(signature_version="s3v4"),
        )
    return _client


def is_configured() -> bool:
    return bool(settings.STORAGE_ACCESS_KEY_ID and settings.STORAGE_SECRET_KEY and settings.STORAGE_BUCKET_NAME)


def upload_bytes(content: bytes, extension: str, content_type: str = "application/octet-stream") -> str:
    """Uploads to the (private) bucket, returns the media_ref (object key)."""
    if not is_configured():
        raise RuntimeError(
            "Cloud storage is not configured — set STORAGE_ACCESS_KEY_ID, "
            "STORAGE_SECRET_KEY, and STORAGE_BUCKET_NAME in Render's Environment tab."
        )

    media_ref = f"{uuid.uuid4().hex}{extension}"
    client = _get_client()
    client.put_object(
        Bucket=settings.STORAGE_BUCKET_NAME,
        Key=media_ref,
        Body=content,
        ContentType=content_type,
    )
    return media_ref


def get_signed_url(media_ref: str, expires_in: int = DEFAULT_URL_EXPIRY_SECONDS) -> str:
    """
    Generates a temporary signed URL for reading a private object.
    Call this fresh whenever a client needs to actually display/download
    the file — don't store the URL itself, store the media_ref and
    re-sign on read, since signed URLs expire.
    """
    if not is_configured():
        raise RuntimeError("Cloud storage is not configured.")
    client = _get_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.STORAGE_BUCKET_NAME, "Key": media_ref},
        ExpiresIn=expires_in,
    )


def delete_object(media_ref: str) -> bool:
    if not is_configured():
        return False
    try:
        _get_client().delete_object(Bucket=settings.STORAGE_BUCKET_NAME, Key=media_ref)
        return True
    except ClientError:
        return False
