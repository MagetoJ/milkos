# Milkos Backend

FastAPI backend for the Milkos cooperative milk collection platform.

This repository is intentionally **separate from the Next.js frontend**. The existing `milkos` repository remains a migration/reference source and is not modified by this project.

## Current phase: Authentication foundation

The first implementation phase establishes:

- FastAPI application structure
- PostgreSQL/SQLAlchemy async configuration
- Keycloak OIDC JWT validation using the issuer JWKS
- issuer and audience validation
- authenticated-user dependency
- Milkos `User` identity mapping from the Keycloak `sub` claim
- active membership lookup
- role authorization dependency
- cooperative/tenant authorization dependency
- security/audit event model foundations

## Identity architecture

Keycloak remains the identity provider. The API does **not** store user passwords.

```text
Next.js frontend
       |
       | OIDC / PKCE
       v
    Keycloak
       |
       | access token
       v
    FastAPI
       |
       +--> validate JWT
       +--> map Keycloak `sub` -> Milkos User
       +--> resolve active Membership
       +--> enforce role + cooperative access
       v
   PostgreSQL
```

## Development

### 1. Create the virtual environment

PowerShell:

```powershell
cd C:\Users\DELL\Projects
mkdir milkos-backend
# If you copied this repository here, enter it first.
cd .\milkos-backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
```

### 2. Configure environment

```powershell
Copy-Item .env.example .env
```

Set `DATABASE_URL`, `KEYCLOAK_ISSUER`, and `KEYCLOAK_AUDIENCE` for your local infrastructure, and set `OTP_SECRET` to a random value of at least 32 characters (`python -c "import secrets; print(secrets.token_urlsafe(48))"`).

### 3. Run the API

```powershell
uvicorn app.main:app --reload --port 8000
```

### 4. Apply migrations

```powershell
alembic upgrade head
```

## Authentication and onboarding API

All endpoints except health require a Keycloak access token (`Authorization: Bearer ...`) issued to the `milk-web` client for the `milk-api` audience.

| Method | Path (under `/api/v1`) | Who |
| --- | --- | --- |
| `POST` | `/auth/register` | Any signed-in user. Idempotently creates the Milkos user; grants no cooperative access. |
| `GET` | `/auth/me` | Registered user. Profile, platform roles, and active memberships. |
| `POST` | `/cooperatives/registration/verify/start` | Applicant. Sends a phone OTP (`{channel, destination}`). |
| `POST` | `/cooperatives/registration/verify/confirm` | Applicant. `{verification_id, code}`. |
| `POST` | `/cooperatives/applications` | Applicant. Requires a phone verification that the same user completed in the last 30 minutes. |
| `GET` | `/cooperatives/applications/mine` | Applicant. Their own applications. |
| `GET` | `/cooperatives/applications/by-reference/{reference}` | Applicant. Only their own application. |
| `GET` | `/cooperatives/applications?status=` | `PLATFORM_SUPER_ADMIN` realm role. |
| `POST` | `/cooperatives/applications/{id}/review` | `PLATFORM_SUPER_ADMIN`. `{status, notes}`. |
| `GET` | `/cooperatives/{cooperative_id}` | Active member of that approved cooperative. |

### Registration flow

1. The user signs in with Keycloak (OIDC + PKCE, Google via the Keycloak identity broker) and the frontend calls `POST /auth/register`.
2. Phone OTP: `verify/start`, then `verify/confirm`. OTPs are HMAC-SHA256 hashed with `OTP_SECRET`, expire after 10 minutes, lock after 5 wrong attempts, and are rate-limited per user, per destination and per IP. The challenge is bound to the user who started it.
3. `POST /cooperatives/applications` creates a `PENDING` cooperative and its application, and consumes the verification so it cannot be reused.
4. A platform administrator reviews it. Approval creates the applicant's `COOPERATIVE_MANAGER` membership in the same transaction. Administrators cannot review their own application.

No SMS provider is wired up yet. In development, set `EXPOSE_DEV_OTP=true` to receive the code in the `verify/start` response. Without it, `verify/start` returns `503` (the app refuses to enable this flag when `ENVIRONMENT=production`).

### Tenant isolation

- Cooperative IDs are generated server-side, and request bodies reject unknown fields, so clients cannot choose a tenant ID, status, or applicant.
- Access to a cooperative comes only from the caller's own `ACTIVE` membership in an `APPROVED` cooperative (`require_cooperative_membership`). Pending, rejected, and suspended cooperatives grant nothing. Non-members get `404`, so tenant IDs cannot be probed.
- Once access is granted, `app.current_cooperative` is set for the transaction so PostgreSQL row-level security policies can scope tenant-owned tables.
- Duplicate cooperatives and a second open application per applicant are rejected by unique indexes, not only by pre-checks, so concurrent requests cannot bypass them.
- `audit_events` and `security_events` are append-only, enforced by a database trigger.

## Tests

Unit tests run without a database. The integration tests need a disposable PostgreSQL database. Never point them at a real one, because they truncate every table:

```powershell
docker run -d --rm --name milkos-test-pg -e POSTGRES_USER=milk -e POSTGRES_PASSWORD=milk -e POSTGRES_DB=milk_test -p 55432:5432 postgres:16-alpine
$env:TEST_DATABASE_URL="postgresql+asyncpg://milk:milk@localhost:55432/milk_test"
pytest
```

## Database schema

This backend owns its schema through Alembic (`alembic/versions`). It uses snake_case tables (`users`, `cooperatives`, `memberships`, ...) and does not share tables with the Prisma schema in the original `milkos` repository. Moving any existing Prisma data over needs a separate data migration.

## Security direction

Authentication is delegated to Keycloak. FastAPI is responsible for token verification and application authorization. Authorization must not rely solely on a realm role: cooperative access is resolved through the user's active Milkos membership.
