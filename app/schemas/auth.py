import re
from typing import Optional
from pydantic import BaseModel, field_validator


class SignupRequest(BaseModel):
    phone: str
    username: str
    password: str
    country: str
    language: str
    business_role: Optional[str] = None
    interest: Optional[str] = None
    marital_status: Optional[str] = None
    religion: Optional[str] = None
    feed_preferences: list[str] = []

    @field_validator("phone")
    @classmethod
    def phone_must_start_with_plus(cls, v: str) -> str:
        if not v.startswith("+"):
            raise ValueError("Phone number must start with '+' (international format required)")
        if not re.match(r"^\+\d{7,15}$", v):
            raise ValueError("Phone number format looks invalid")
        return v

    @field_validator("username")
    @classmethod
    def username_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Username cannot be empty")
        return v


class SignupResponse(BaseModel):
    signup_token: str
    expires_in: int
    otp: Optional[str] = None  # TEMP: dev-mode OTP passthrough until a real SMS provider is wired up — remove before production


class OTPVerifyRequest(BaseModel):
    signup_token: str
    otp: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    phone: str
    password: str
