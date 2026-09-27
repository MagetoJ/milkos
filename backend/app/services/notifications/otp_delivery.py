from fastapi import HTTPException, status

from app.models.registration import VerificationChannel


async def deliver_otp(channel: VerificationChannel, destination: str, code: str) -> None:
    """Send an OTP to the user's phone or email.

    No SMS/email provider (e.g. Africa's Talking) is wired up yet. Fail
    loudly rather than pretend a code was sent; in development set
    EXPOSE_DEV_OTP=true to receive codes in the API response instead.
    """
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Verification delivery is unavailable",
    )
