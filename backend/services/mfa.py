"""Time-based one-time passwords (RFC 6238, the scheme every authenticator app speaks) for multi-factor sign-in.

The shared secret is encrypted at rest with Fernet under MFA_ENCRYPTION_KEY (or a key derived from SECRET_KEY
when that isn't set), shown to the user exactly once while enrolling, and never logged. Recovery codes are
stored as hashes and each works once.
"""
import base64
import datetime
import hashlib
import hmac
import os
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

from core.security import SECRET_KEY, hash_token

ISSUER = "MilkOS"
PERIOD = 30
DIGITS = 6
RECOVERY_CODES = 8


def _fernet() -> Fernet:
    raw = os.getenv("MFA_ENCRYPTION_KEY")
    if raw:
        return Fernet(raw.encode())
    derived = hashlib.sha256(f"milkos-mfa:{SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** DIGITS).zfill(DIGITS)


def totp(secret: str, at: Optional[float] = None) -> str:
    return _code(secret, int((at if at is not None else time.time()) // PERIOD))


def verify_totp(secret: Optional[str], code: str, at: Optional[float] = None, window: int = 1) -> bool:
    """True when `code` matches the current 30-second step or one step either side (clock drift)."""
    if not secret or not code or not code.strip().isdigit():
        return False
    code = code.strip()
    now = int((at if at is not None else time.time()) // PERIOD)
    return any(hmac.compare_digest(_code(secret, now + step), code) for step in range(-window, window + 1))


def provisioning_uri(secret: str, account: str) -> str:
    label = quote(f"{ISSUER}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(ISSUER)}&digits={DIGITS}&period={PERIOD}"


def new_recovery_codes() -> tuple[list[str], list[str]]:
    """(codes shown to the user once, hashes to store)."""
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}".upper() for _ in range(RECOVERY_CODES)]
    return codes, [hash_token(c) for c in codes]


def use_recovery_code(stored: Optional[list], code: str) -> Optional[list]:
    """The remaining hashes after spending `code`, or None if it isn't one of them."""
    digest = hash_token((code or "").strip().upper())
    remaining = list(stored or [])
    for value in remaining:
        if hmac.compare_digest(value, digest):
            remaining.remove(value)
            return remaining
    return None


def now() -> datetime.datetime:
    return datetime.datetime.utcnow()
