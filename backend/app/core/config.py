from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = Field(
        default="milks API",
        alias="APP_NAME",
    )

    environment: str = Field(
        default="development",
        alias="ENVIRONMENT",
    )

    debug: bool = Field(
        default=False,
        alias="DEBUG",
    )

    api_prefix: str = Field(
        default="/api/v1",
        alias="API_PREFIX",
    )

    database_url: str = Field(
        alias="DATABASE_URL",
    )

    keycloak_issuer: str = Field(
        alias="KEYCLOAK_ISSUER",
    )

    keycloak_audience: str = Field(
        alias="KEYCLOAK_AUDIENCE",
    )

    keycloak_client_id: str = Field(
        alias="KEYCLOAK_CLIENT_ID",
    )

    cors_origins: str = Field(
        default="http://localhost:3000",
        alias="CORS_ORIGINS",
    )

    log_level: str = Field(
        default="INFO",
        alias="LOG_LEVEL",
    )

    jwks_cache_seconds: int = Field(
        default=300,
        alias="JWKS_CACHE_SECONDS",
        ge=30,
        le=3600,
    )

    # Realm role (from the access token) that grants platform administration.
    platform_admin_role: str = Field(
        default="PLATFORM_SUPER_ADMIN",
        alias="PLATFORM_ADMIN_ROLE",
    )

    # Server-side pepper for OTP hashes. A leaked database alone must not
    # allow brute-forcing 6-digit codes offline.
    otp_secret: SecretStr = Field(
        alias="OTP_SECRET",
        min_length=32,
    )

    # Development only: return the OTP in the API response instead of
    # delivering it. Refused in production.
    expose_dev_otp: bool = Field(
        default=False,
        alias="EXPOSE_DEV_OTP",
    )

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @model_validator(mode="after")
    def _forbid_unsafe_production_flags(self) -> "Settings":
        if self.is_production and self.expose_dev_otp:
            raise ValueError("EXPOSE_DEV_OTP must not be enabled in production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()