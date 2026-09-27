"""Test configuration.

Integration tests need a disposable PostgreSQL database, e.g.:

    docker run -d --rm --name milkos-test-pg -e POSTGRES_USER=milk \
        -e POSTGRES_PASSWORD=milk -e POSTGRES_DB=milk_test -p 55432:5432 postgres:16-alpine
    $env:TEST_DATABASE_URL="postgresql+asyncpg://milk:milk@localhost:55432/milk_test"

Without TEST_DATABASE_URL they are skipped. The database is migrated to head
and truncated between tests, so never point it at a real database.
"""

import os

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

if TEST_DATABASE_URL:
    # Must happen before anything imports app settings (they are cached).
    os.environ.update(
        {
            "DATABASE_URL": TEST_DATABASE_URL,
            "ENVIRONMENT": "test",
            "KEYCLOAK_ISSUER": "http://keycloak.test/realms/milk",
            "KEYCLOAK_AUDIENCE": "milk-api",
            "KEYCLOAK_CLIENT_ID": "milk-web",
            "OTP_SECRET": "test-otp-secret-that-is-at-least-32-characters",
            "EXPOSE_DEV_OTP": "true",
            "PLATFORM_ADMIN_ROLE": "PLATFORM_SUPER_ADMIN",
        }
    )
