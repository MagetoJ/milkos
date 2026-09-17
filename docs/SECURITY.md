# Security Design

## Authentication
Keycloak is the identity provider. The API validates OIDC access tokens. Platform administrators and cooperative managers require MFA. Password reset is handled by Keycloak with short-lived single-use reset actions and session revocation after sensitive recovery.

## Registration
A cooperative applicant must verify a phone OTP or authenticate through Google before account/application creation. Registration responses must not disclose whether an email or phone is already registered.

## Tenant isolation
Every tenant-owned entity carries cooperative_id. The service layer checks membership and role. PostgreSQL RLS policies must be enabled in production and set the current tenant context inside each transaction/request. Never trust a cooperative ID supplied by a client.

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
