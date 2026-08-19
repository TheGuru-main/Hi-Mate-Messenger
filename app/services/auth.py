"""
Password hashing, JWT issuance, and OTP generation/verification.
"""
import random
import secrets
from datetime import datetime, timedelta

from jose import jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def generate_signup_token() -> str:
    return secrets.token_urlsafe(32)


def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def hash_otp(otp: str) -> str:
    # OTPs are short-lived and low-entropy — a fast hash is fine here,
    # this is NOT the password hash.
    return pwd_context.hash(otp)


def verify_otp(otp: str, hashed: str) -> bool:
    return pwd_context.verify(otp, hashed)


def create_access_token(uid: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": uid, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(uid: str) -> str:
    expire = datetime.utcnow() + timedelta(days=365)  # persistent login — long-lived
    payload = {"sub": uid, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
