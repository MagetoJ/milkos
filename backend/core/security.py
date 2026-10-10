import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

load_dotenv()

logger = logging.getLogger("milkflow.security")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY is not set. Put a long random value in backend/.env "
        "(generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\")."
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15  # 15-minute active token window

# BCRYPT_ROUNDS may be lowered for the test suite only; production keeps the library default (12).
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=int(os.getenv("BCRYPT_ROUNDS", "12")))


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: Optional[str]) -> bool:
    if not hashed_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (UnknownHashError, ValueError):
        logger.error("Stored password_hash is not a valid bcrypt hash.")
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def access_token_for(user) -> str:
    """The access token for `user`. `sv` is the account's session epoch: bumping it ends every older token."""
    return create_access_token(data={
        "sub": str(user.id), "email": user.email, "role": user.role_value, "sv": int(user.session_epoch or 0),
    })


def create_purpose_token(subject: str, purpose: str, minutes: int, **extra) -> str:
    """A short-lived signed token that is NOT an access token (e.g. the second step of an MFA sign-in)."""
    return create_access_token({"sub": subject, "purpose": purpose, **extra}, timedelta(minutes=minutes))


def decode_purpose_token(token: str, purpose: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    return payload if payload.get("purpose") == purpose else None


def generate_token() -> str:
    """A random URL-safe one-time token (activation link, password reset): 256 bits."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Tokens are stored only as SHA-256 hashes (they are long and random, so a keyless hash is enough)."""
    return hashlib.sha256(token.encode()).hexdigest()


def generate_otp(digits: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(digits))


def hash_otp(code: str, context: str) -> str:
    """Short numeric codes are hashed with the server key and bound to their challenge, so a leaked row can't
    be brute-forced offline or replayed against another challenge."""
    return hmac.new(SECRET_KEY.encode(), f"{context}:{code}".encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose"):
            raise JWTError("not an access token")
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )