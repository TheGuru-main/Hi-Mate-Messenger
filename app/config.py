"""
Hi-Mate backend configuration.
Reads from environment variables — on Render, set these in the service's
Environment tab. Locally, create a .env file (see .env.example).
"""
import os
from functools import lru_cache


class Settings:
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "postgresql://localhost/himate_dev"
    )

    # Auth
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me-in-production")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30  # 30 days, matches "persistent login"

    # OTP (Africa's Talking, per locked spec)
    AT_USERNAME: str = os.getenv("AT_USERNAME", "")
    AT_API_KEY: str = os.getenv("AT_API_KEY", "")
    OTP_EXPIRE_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 5

    # App
    APP_VERSION: str = "1.0.0.1"
    IDENTITY_VERSION: int = 1

    # Relationship grid
    ROW_RANGE: int = 64
    GRID_COLS: int = 220
    RELATIONSHIP_K: int = 250
    FORWARD_D: int = 5
    BACKWARD_D: int = 1

    # Crawler result caps per surface
    CAP_FEED: int = 100
    CAP_KLIQUE: int = 50
    CAP_OTHER: int = 25


@lru_cache()
def get_settings() -> Settings:
    return Settings()
