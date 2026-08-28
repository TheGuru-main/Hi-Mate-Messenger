"""
Real cloud object storage for user media — S3-compatible API, so this
works unchanged against AWS S3, Cloudflare R2, or Backblaze B2 depending
on which STORAGE_* env vars you set. This is PUBLIC/production storage
for actual user-uploaded media — not to be confused with any client-side
session cache (that's a frontend concern, unrelated to this file).

Setup (Cloudflare R2 recommended — S3-compatible, no egress fees):
  1. Create an R2 bucket in the Cloudflare dashboard
  2. Create an R2 API token (Account API token with R2 read/write)
  3. Set these env vars in Render:
       STORAGE_ENDPOINT_URL   = https://<account_id>.r2.cloudflarestorage.com
       STORAGE_ACCESS_KEY_ID  = <your R2 access key>
       STORAGE_SECRET_KEY     = <your R2 secret key>
       STORAGE_BUCKET_NAME    = himate-media
       STORAGE_PUBLIC_URL_BASE = https://<your-r2-public-domain>  (R2 custom domain or public bucket URL)

  For AWS S3 instead: set STORAGE_ENDPOINT_URL to the S3 regional
  endpoint (or omit it — boto3 defaults to AWS if unset) and use your
  AWS credentials/bucket instead.
"""
import uuid

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import get_settings

settings = get_settings()

_client = None


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
    """
    Uploads a file's bytes to cloud storage, returns the media_ref (the
    object key). Raises RuntimeError if storage isn't configured, so a
    misconfigured deploy fails loudly at upload time rather than silently
    losing files.
    """
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


def get_public_url(media_ref: str) -> str:
    """Public URL for a stored object, using the configured public base."""
    base = settings.STORAGE_PUBLIC_URL_BASE.rstrip("/")
    return f"{base}/{media_ref}"


def delete_object(media_ref: str) -> bool:
    if not is_configured():
        return False
    try:
        _get_client().delete_object(Bucket=settings.STORAGE_BUCKET_NAME, Key=media_ref)
        return True
    except ClientError:
        return False
