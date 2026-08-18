"""
SMS delivery via Africa's Talking, per the locked OTP flow:
  Backend generates OTP -> sent via Africa's Talking API -> SMS to user's SIM
  -> user enters OTP -> backend verifies stored OTP hash.
"""
import httpx

from app.config import get_settings

settings = get_settings()

AT_SEND_URL = "https://api.africastalking.com/version1/messaging"


async def send_otp_sms(phone: str, otp: str) -> bool:
    """
    Sends the OTP via Africa's Talking. Returns True on success.
    In local/dev environments without AT credentials configured, this
    logs instead of sending — set AT_USERNAME/AT_API_KEY in production.
    """
    if not settings.AT_USERNAME or not settings.AT_API_KEY:
        print(f"[DEV MODE] OTP for {phone}: {otp}")  # no SMS provider configured
        return True

    headers = {
        "apiKey": settings.AT_API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    data = {
        "username": settings.AT_USERNAME,
        "to": phone,
        "message": f"Your Hi-Mate verification code is {otp}. It expires in {settings.OTP_EXPIRE_MINUTES} minutes.",
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(AT_SEND_URL, headers=headers, data=data)
        return response.status_code == 201 or response.status_code == 200
