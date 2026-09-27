# Backend - Milk Collection Management Platform Guidelines

## Tech Stack & Architecture
- **Framework:** NestJS (TypeScript)[cite: 1]
- **Database & ORM:** PostgreSQL + Prisma ORM[cite: 1]
- **Auth & IAM:** Keycloak (RBAC & Multi-tenant context)[cite: 1]
- **Queues & Cache:** Redis + BullMQ (Offline sync & async workflows)[cite: 1]
- **Observability:** OpenTelemetry[cite: 1]

## Core Domain & Data Integrity Rules
1. **Authoritative Validation:** Frontend validation is for UX only; backend validation is mandatory and atomic[cite: 1].
2. **Allocation Verification:** Milk batch allocations must equal total received weight down to exact decimal precision[cite: 1]. Reject mismatched allocations.
3. **Offline Sync Idempotency:** Duplicate queue processing or retry attempts from offline mobile apps must never generate duplicate collection records[cite: 1].
4. **SMS Credit Ledger:**
   - Ledger-derived credit state[cite: 1].
   - Ledger entry types: Purchase, Issued, Reserved, Consumed, Released, Refunded, Transfer, Adjustment[cite: 1].
   - Never directly update credit balance counts without a corresponding immutable ledger transaction[cite: 1].
5. **Maker-Checker Governance:**
   - Reversals require strict maker-checker workflows[cite: 1].
   - **Rule:** The user who requested a reversal CANNOT approve their own reversal request[cite: 1].
   - Original records are immutable and must never be overwritten on correction (log corrections as requested vs approved)[cite: 1].
6. **Auditability:** Maintain activity timelines for entities (created, synced, correction requested, approved)[cite: 1].

## Common Commands
- **Dev Server:** `npm run start:dev`
- **Prisma Migration:** `npx prisma migrate dev`
- **Prisma Generate:** `npx prisma generate`
- **Lint:** `npm run lint`
- **Unit / E2E Tests:** `npm run test` / `npm run test:e2e`

## Security & API Design
- Secure all endpoints with Keycloak guards.
- Enforce Tenant and Cooler boundary checks on all queries.
- Never expose technical HTTP 500 details, raw tokens, or plain secrets in response payloads[cite: 1].