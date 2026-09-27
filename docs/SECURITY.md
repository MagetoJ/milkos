# Security Design

## Authentication
Supabase Auth is the identity provider (Google, email + password, email OTP; phone OTP planned). The API verifies Supabase access tokens (issuer, audience, signature via JWKS) and rejects non-user tokens such as the service role. Platform roles, cooperative managers and accountants must hold an aal2 (TOTP) session. Roles and memberships are read from the database per request, so suspension and revocation are immediate. See `docs/AUTH.md`.

## Registration
A cooperative applicant must verify a phone OTP or authenticate through Google before account/application creation. Registration responses must not disclose whether an email or phone is already registered.

## Tenant isolation
Every tenant-owned entity carries cooperative_id. The service layer checks membership and role. PostgreSQL RLS policies are enforced by running each tenant transaction as the `milkos_app` role (no BYPASSRLS) with the tenant set transaction-locally; the Supabase `anon`/`authenticated` roles have no table access. Never trust a cooperative ID supplied by a client.

## Audit
AuditEvent is append-only at the application level. No UPDATE or DELETE endpoint should exist. Audit retention is two years. SecurityEvent is separate from application logging.

## Logging
Use structured JSON. Redact authorization headers, cookies, tokens, passwords, OTPs and reset tokens. Authentication attempts record IP address and user agent. Use centralized collection and rotation. Recommended baseline retention: application 30 days, security 90 days, audit 2 years.

## Corrections and reversals
Corrections require manager approval. Reversals use maker-checker and reject approval when requestedBy equals approvedBy. Historical values are retained in audit before/after state.

## Notifications
Collection success does not depend on SMS success. Notifications are asynchronous, retry with exponential backoff and move to MANUAL_RETRY after the retry limit. Provider credentials must come from secrets, never source control.

## Offline synchronization
Each offline collection requires a unique idempotency key. Database uniqueness on cooperative_id + idempotency_key prevents duplicate records after retries.
