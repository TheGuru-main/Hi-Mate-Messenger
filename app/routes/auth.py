from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import get_settings
from app.models.user import User
from app.models.otp import OTPVerification
from app.schemas.auth import (
    SignupRequest, SignupResponse, OTPVerifyRequest, TokenResponse, LoginRequest,
)
from app.services import auth as auth_service, placement, sms

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/signup", response_model=SignupResponse)
async def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    uid = placement.strip_plus(payload.phone)

    existing = db.query(User).filter(User.uid == uid).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account with this phone number already exists")

    otp = auth_service.generate_otp()
    signup_token = auth_service.generate_signup_token()

    record = OTPVerification(
        signup_token=signup_token,
        phone=payload.phone,
        otp_hash=auth_service.hash_otp(otp),
        expires_at=datetime.utcnow() + timedelta(minutes=settings.OTP_EXPIRE_MINUTES),
        pending_username=payload.username,
        pending_password_hash=auth_service.hash_password(payload.password),
        pending_country=payload.country,
        pending_language=payload.language,
        pending_business_role=payload.business_role,
        pending_interest=payload.interest,
        pending_marital_status=payload.marital_status,
        pending_religion=payload.religion,
        pending_feed_preferences=",".join(payload.feed_preferences),
    )
    db.add(record)
    db.commit()

    try:
        await sms.send_otp_sms(payload.phone, otp)
    except Exception as e:
        # TEMP: Africa's Talking not fully set up yet — do not block signup on SMS failure.
        print(f"[signup] SMS send failed, continuing anyway (dev mode): {e}")

    return SignupResponse(signup_token=signup_token, expires_in=settings.OTP_EXPIRE_MINUTES * 60, otp=otp)  # TEMP: dev-mode passthrough


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(payload: OTPVerifyRequest, db: Session = Depends(get_db)):
    record = db.query(OTPVerification).filter(
        OTPVerification.signup_token == payload.signup_token
    ).first()

    if not record:
        raise HTTPException(status_code=404, detail="Signup session not found")
    if record.verified:
        raise HTTPException(status_code=400, detail="Already verified")
    if datetime.utcnow() > record.expires_at:
        raise HTTPException(status_code=400, detail="OTP expired — please sign up again")
    if record.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts")

    record.attempts += 1
    if not auth_service.verify_otp(payload.otp, record.otp_hash):
        db.commit()
        raise HTTPException(status_code=400, detail="Incorrect OTP")

    # OTP correct — create the real user, computing placement server-side
    uid = placement.strip_plus(record.phone)
    p = placement.compute_placement(record.pending_username, uid)

    user = User(
        uid=uid,
        phone=record.phone,
        username=record.pending_username,
        password_hash=record.pending_password_hash,
        country=record.pending_country,
        language=record.pending_language,
        business_role=record.pending_business_role,
        interest=record.pending_interest,
        marital_status=record.pending_marital_status,
        religion=record.pending_religion,
        feed_preferences=record.pending_feed_preferences,
        L=p["L"], S=p["S"], C=p["C"], start_row=p["start_row"],
        identity_version=1,
        app_version=settings.APP_VERSION,
    )
    db.add(user)
    record.verified = True
    db.commit()

    access_token = auth_service.create_access_token(uid)
    refresh_token = auth_service.create_refresh_token(uid)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: Session = Depends(get_db)):
    uid = placement.strip_plus(payload.phone)
    user = db.query(User).filter(User.uid == uid).first()
    if not user or not auth_service.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid phone number or password")

    access_token = auth_service.create_access_token(uid)
    refresh_token = auth_service.create_refresh_token(uid)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)
