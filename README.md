# Cooperative Milk Collection Platform

Production-oriented monorepo foundation for a multi-tenant milk collection platform.

## Stack
- Next.js + TypeScript web dashboard
- NestJS API
- PostgreSQL + Prisma
- Redis + BullMQ
- Keycloak OIDC authentication
- Pino structured logging
- OpenTelemetry-ready correlation IDs
- Docker Compose

## Security model
- Tenant isolation at application level and PostgreSQL RLS-ready design
- Keycloak owns credentials and MFA
- Argon2id is configured at the identity-provider layer where supported
- Immutable application audit records
- Security events separated from application logs
- IP/user-agent captured for authentication attempts
- Rate limiting and generic authentication responses
- Idempotency keys for offline synchronization
- Correction approval and maker-checker reversal workflow
- Notification retries with dead-letter/manual retry state

## Run
1. Copy `.env.example` to `.env`.
2. `docker compose up -d postgres redis keycloak`
3. `npm install`
4. `npm run db:generate`
5. `npm run db:migrate`
6. `npm run dev`

Web: http://localhost:3000
API: http://localhost:4000
Keycloak: http://localhost:8080

This is the initial implementation foundation. Provider credentials, production secrets, domain names and final operational retention policies must be supplied before production deployment.

## Current build stage

The project now includes the cooperative onboarding verification flow, applicant status lookup and Platform Super Admin application review APIs/UI. See `docs/NEXT_STAGE.md` for the implementation boundary and production hardening list.
