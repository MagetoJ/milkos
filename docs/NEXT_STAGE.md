# Next stage: Identity, onboarding and administration

Implemented in this stage:

- Public cooperative registration starts with contact verification.
- Phone OTP verification with hashed OTPs, expiry, attempt lockout and rate limiting at the verification-record level.
- Google is represented as a verification channel and is intended to be backed by Keycloak OIDC in production.
- Cooperative application creation requires a verified phone in the current starter flow.
- Duplicate cooperative name/registration checks.
- Applicant application reference and status lookup endpoint.
- Platform Super Admin application listing and review endpoint.
- Approval creates the applicant's Cooperative Manager membership.
- Rejection and more-information states are retained.
- Security and audit events are recorded for verification and application decisions.
- Applicant status page and initial platform application review page.

Production hardening still required before exposing registration publicly:

1. Complete Keycloak Google OIDC and phone OTP identity broker flow.
2. Replace development OTP return with a notification delivery path.
3. Bind the verified identity to the created Keycloak user before application creation.
4. Require authenticated Platform Super Admin JWTs on review operations.
5. Add CAPTCHA/IP reputation and distributed rate limiting with Redis.
6. Add transactional outbox for notifications and application status emails.
7. Add e2e tests for tenant isolation and authorization.
