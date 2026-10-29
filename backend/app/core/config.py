
import os
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


def _flag(name: str, default: str = "false", true_values: frozenset = frozenset({"1", "true", "yes"})) -> bool:
    return os.getenv(name, default).strip().lower() in true_values


DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL")
SECRET_KEY: Optional[str] = os.getenv("SECRET_KEY")
# May be lowered for the test suite only; production keeps the library default (12).
BCRYPT_ROUNDS: int = int(os.getenv("BCRYPT_ROUNDS", "12"))

# Session and access token expiration in minutes (default: 15 minutes)
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))

LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
# Public URL of the web app (links in SMS, OAuth redirects).
APP_URL: str = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
# Explicit origins are required when allow_credentials=True. Comma-separated.
CORS_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]
# true behind HTTPS so the session cookie is never sent over plain HTTP.
COOKIE_SECURE: bool = _flag("COOKIE_SECURE")

GOOGLE_CLIENT_ID: Optional[str] = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET: Optional[str] = os.getenv("GOOGLE_CLIENT_SECRET")