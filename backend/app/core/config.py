import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


def _flag(name: str, default: str = "false", true_values: frozenset = frozenset({"1", "true", "yes"})) -> bool:
    return os.getenv(name, default).strip().lower() in true_values


class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://milkos_user:Lokeshen@58@localhost:5432/milkos_db"
    )
    SECRET_KEY: Optional[str] = os.getenv("SECRET_KEY", "change-this-in-production")
    BCRYPT_ROUNDS: int = int(os.getenv("BCRYPT_ROUNDS", "12"))
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    APP_URL: str = os.getenv("APP_URL", "http://localhost:3000").rstrip("/")
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if origin.strip()
    ]
    COOKIE_SECURE: bool = _flag("COOKIE_SECURE")
    GOOGLE_CLIENT_ID: Optional[str] = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: Optional[str] = os.getenv("GOOGLE_CLIENT_SECRET")


# Main settings instance
settings = Settings()


def get_settings() -> Settings:
    """Dependency / Helper getter for settings."""
    return settings

def get_database_url(url: str) -> str:
    if not url:
        return url
    
    # Standardize scheme for asyncpg
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    # Ensure sslmode is valid for asyncpg
    if "?sslmode=" in url or "&sslmode=" in url:
        # Convert invalid/unsupported query params if necessary or set sslmode=require for Render
        url = url.replace("sslmode=prefer", "sslmode=require")
        url = url.replace("sslmode=no-verify", "sslmode=disable")
        
    return url


# Top-level module exports to support direct imports like `from app.core.config import DATABASE_URL`
DATABASE_URL = settings.DATABASE_URL
SECRET_KEY = settings.SECRET_KEY
BCRYPT_ROUNDS = settings.BCRYPT_ROUNDS
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
LOG_LEVEL = settings.LOG_LEVEL
APP_URL = settings.APP_URL
CORS_ORIGINS = settings.CORS_ORIGINS
COOKIE_SECURE = settings.COOKIE_SECURE
GOOGLE_CLIENT_ID = settings.GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET = settings.GOOGLE_CLIENT_SECRET