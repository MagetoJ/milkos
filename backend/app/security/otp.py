import hashlib
import hmac
import secrets
from uuid import UUID

from app.core.config import get_settings

OTP_DIGITS = 6


def generate_otp() -> str:
    return f"{secrets.randbelow(10**OTP_DIGITS):0{OTP_DIGITS}d}"


def hash_otp(verification_id: UUID, code: str) -> str:
    """HMAC the code with a server secret, bound to its verification record.

    A plain SHA-256 of a 6-digit code is reversible by enumerating a million
    candidates; the server-side key makes a leaked hash useless on its own,
    and binding the record ID prevents moving a hash between records.
    """
    key = get_settings().otp_secret.get_secret_value().encode()
    message = f"{verification_id}:{code}".encode()
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def otp_matches(verification_id: UUID, code: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(verification_id, code), expected_hash)
