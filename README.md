# Cooperative Milk Collection Platform

Production-oriented monorepo foundation for a multi-tenant milk collection platform.

## Stack
- Next.js + TypeScript web dashboard
- NestJS API
- PostgreSQL (Supabase) + Prisma
- Redis + BullMQ
- Supabase Auth (Google, email/password, email OTP, TOTP MFA) with API-side RBAC
- Pino structured logging
- OpenTelemetry-ready correlation IDs
- Docker Compose

## Security model
- Tenant isolation enforced by membership checks and PostgreSQL RLS under a non-bypass runtime role (see `docs/AUTH.md`)
- Supabase Auth owns credentials, sessions and MFA; roles and memberships live in the Milkos database
- Immutable application audit records
- Security events separated from application logs
- IP/user-agent captured for authentication attempts
- Rate limiting and generic authentication responses
- Idempotency keys for offline synchronization
- Correction approval and maker-checker reversal workflow
- Notification retries with dead-letter/manual retry state

## Run
1. `supabase start` (Supabase CLI) — local Postgres, Auth and a Mailpit inbox for emails.
2. Configure `apps/api/.env` and `apps/web/.env.local` from `.env.example`.
3. `pnpm install`
4. `pnpm --filter @milk/api prisma:generate && pnpm --filter @milk/api prisma:deploy`
5. `pnpm --filter @milk/api auth:bootstrap-super-admin -- you@example.com "Your Name"`
6. `npm run dev`

Web: http://localhost:3000 · API: http://localhost:4000 · Supabase Studio: http://127.0.0.1:54323 · Mail: http://127.0.0.1:54324

Full auth/RBAC/tenant design and hosted-Supabase setup: `docs/AUTH.md`.

This is the initial implementation foundation. Provider credentials, production secrets, domain names and final operational retention policies must be supplied before production deployment.

## Current build stage

The project now includes the cooperative onboarding verification flow, applicant status lookup and Platform Super Admin application review APIs/UI. See `docs/NEXT_STAGE.md` for the implementation boundary and production hardening list.

## SMS verification and tenant context

Phone verification sends through Africa's Talking when `SMS_PROVIDER=africastalking`. Configure `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, and optionally `AFRICASTALKING_SENDER_ID`. The API stores only the SHA-256 code hash and never returns the OTP in a response. `SMS_PROVIDER=dummy` is a non-production simulation; it does not deliver or disclose the code. Production requests fail closed if the real provider is unavailable or credentials are missing.

Tenant-scoped API requests resolve cooperative access from the authenticated Supabase user and active `Membership` records. Users with one active cooperative use it automatically; users with multiple memberships must send `x-cooperative-id` for tenant-scoped requests. The request interceptor starts a Prisma interactive transaction, switches to the `milkos_app` role (no BYPASSRLS), sets transaction-local `app.current_cooperative_id`, and routes service queries through that transaction. Public onboarding and health routes do not establish tenant context. PostgreSQL policies are applied by the `tenant_row_level_security` Prisma migration; `docs/RLS.sql` contains the corresponding policy definitions.
