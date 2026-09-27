# Authentication, RBAC and tenant isolation

## Architecture

```
Browser (Next.js)                 Supabase Auth                  NestJS API                     Postgres (Supabase)
─────────────────                 ─────────────                  ──────────                     ───────────────────
Google / password /  ──sign in──▶ issues JWT (sub, aal,
email code / TOTP                 session_id), cookies
      │
      │ Authorization: Bearer <access token>
      │ x-cooperative-id: <active tenant>
      └──────────────────────────────────────────────────────▶ AuthGuard
                                                                 verify JWT (JWKS / HS256)
                                                                 load User + memberships ───▶ owner connection
                                                               AccessGuard
                                                                 MFA step-up (aal2)
                                                                 resolve tenant, check membership
                                                                 check @RequirePermissions
                                                               TenantContextInterceptor
                                                                 BEGIN; SET LOCAL ROLE milkos_app;
                                                                 set app.current_cooperative_id ──▶ RLS enforced
```

**Supabase owns credentials** (passwords, Google, email/SMS OTP, TOTP factors, sessions).
**Milkos owns authorization.** Roles and tenant memberships live in our tables and are read on every
request, so revoking access takes effect immediately; nothing role-related is trusted from the JWT.

## Roles

| Scope | Role | Summary |
|---|---|---|
| Platform | `PLATFORM_SUPER_ADMIN` | Everything, including granting platform roles. Created only via CLI bootstrap. |
| Platform | `PLATFORM_ADMIN` | Review cooperative applications, verify SMS payments, read any tenant. |
| Platform | `PLATFORM_SUPPORT` | Read-only across tenants for support. |
| Cooperative | `COOPERATIVE_MANAGER` | Full control of their cooperative, including members. |
| Cooperative | `ACCOUNTANT` | Pricing, SMS purchases, reports, audit; read-only operations. |
| Cooperative | `COLLECTOR` | Record collections, request corrections/reversals. |
| Cooperative | `FARMER` | Placeholder; no cooperative-wide data until self-scoped reads exist. |

Endpoints declare **permissions**, not roles (`@RequirePermissions('farmers:manage')`). The role →
permission matrix is in `apps/api/src/auth/permissions.ts` and is the only copy; the web app receives
resolved permissions from `GET /auth/me` and uses them purely to hide UI.

**MFA:** all platform roles, managers and accountants must hold an `aal2` session (TOTP). The API
answers `403 { code: "MFA_REQUIRED" }` and the web app routes to `/auth/mfa`. Collectors and farmers
are exempt (shared field phones). Disable locally with `AUTH_REQUIRE_MFA=false`.

## Tenant isolation (defence in depth)

1. **Membership check** — `AccessGuard` resolves the cooperative from the route param, body, query or
   `x-cooperative-id` header (explicit sources must agree) and rejects non-members. Suspended or
   unapproved cooperatives are rejected.
2. **Row-level security** — each tenant request runs in a transaction that switches to
   `milkos_app`, a `NOLOGIN NOBYPASSRLS` role, and sets `app.current_cooperative_id`. The owner role
   (`postgres` on Supabase) bypasses RLS, so without this switch the policies would never apply.
3. **Least privilege** — `milkos_app` gets explicit grants only; audit/security/SMS-ledger tables are
   insert-only; OTP records are not readable at all. New tables are **not** granted automatically —
   add a grant and an RLS policy in the same migration.
4. **Supabase Data API lockdown** — `anon` and `authenticated` have no privileges on `public`, so a
   leaked publishable key cannot read tenant data through PostgREST.

Rules for new code:
- Tenant data services use `prisma.tenantClient`. Use the root `prisma` client only for deliberately
  cross-tenant work (identity, platform admin) and mark those controllers `@PlatformScope()`.
- Never register `PrismaService` in a feature module's `providers`; it comes from the global
  `PrismaModule`. A second instance silently escapes the tenant transaction.
- Use `@CurrentUser() user` and `user.id` (Milkos `User.id`) for `createdBy`/`actorUserId`; never
  accept actor ids from request bodies.

## API surface

| Method | Path | Permission |
|---|---|---|
| GET | `/auth/me` | signed in (allowed at aal1) |
| PUT | `/auth/me/default-cooperative` | signed in |
| GET | `/admin/users` | `platform:users:read` |
| POST | `/admin/users/invite` | `platform:users:manage` |
| PATCH | `/admin/users/:id/platform-role` | `platform:users:manage` |
| PATCH | `/admin/users/:id/status` | `platform:users:manage` |
| GET | `/admin/cooperatives` | `platform:cooperatives:read` |
| GET | `/cooperatives/:cooperativeId/members` | `members:read` |
| POST | `/cooperatives/:cooperativeId/members` | `members:manage` |
| PATCH | `/cooperatives/:cooperativeId/members/:membershipId` | `members:manage` |

Guard rails: nobody can change their own platform role, status or membership; the platform always
keeps one active Super Admin; a cooperative always keeps one active manager.

Security events recorded: `AUTH_SIGN_IN` (first request of each Supabase session, with IP, user
agent and sign-in methods), `AUTHORIZATION_DENIED`, `TENANT_ACCESS_DENIED`, `PLATFORM_TENANT_ACCESS`
(platform staff writing inside a tenant). Role, status and membership changes go to `AuditEvent`.

## Web

- `proxy.ts` refreshes the Supabase session cookie and redirects signed-out users to `/login`.
- `AuthProvider` (`components/features/auth/auth-provider.tsx`) exposes `useAuth()`:
  `me`, `activeCooperative`, `setActiveCooperative`, `can(permission)`, `signOut(scope)`.
- `authFetch` / `apiFetch` (`lib/api/client.ts`) attach the bearer token and active cooperative.
- `<RequirePermission permission="...">` guards pages; `Navbar` filters links by permission.
- Pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/mfa`, `/auth/callback`,
  `/auth/confirm`, `/select-cooperative`, `/account`, `/settings/members`, `/admin/users`.

## Local setup

1. Install the Supabase CLI and run `supabase start` from the repo root. Note the API URL,
   publishable/anon key and service-role key it prints. Emails (codes, invites, resets) appear in
   Mailpit at http://127.0.0.1:54324.
2. `apps/api/.env`: set `DATABASE_URL` and `DIRECT_URL` to
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `SUPABASE_URL=http://127.0.0.1:54321`,
   and `SUPABASE_SERVICE_ROLE_KEY`.
3. `apps/web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. `pnpm --filter @milk/api prisma:deploy`.
5. `pnpm --filter @milk/api auth:bootstrap-super-admin -- you@example.com "Your Name"`, then sign in
   and enrol an authenticator app when prompted.
6. Google: create an OAuth client (Web) with redirect URI `http://127.0.0.1:54321/auth/v1/callback`,
   then set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` before `supabase start`.

### Hosted Supabase

- Database: `DATABASE_URL` = transaction pooler (port 6543) with `?pgbouncer=true&connection_limit=1`,
  `DIRECT_URL` = direct/session connection (5432). Run `prisma:deploy` against it.
- Authentication → URL configuration: Site URL = web origin; add `/auth/callback` and `/auth/confirm`
  to redirect URLs.
- Authentication → Emails: paste the templates from `supabase/templates/` (they use `token_hash`
  links, required for server-sent invitations and cross-device links).
- Authentication → Providers: enable Google; MFA → enable TOTP; set minimum password length 10.
- Configure custom SMTP before production; the built-in sender is heavily rate-limited.

## Phase 2: phone OTP (Africa's Talking)

Supabase supports custom SMS delivery through the **Send SMS Hook**. Point it at an API endpoint
that sends through the existing `SmsGatewayService`, enable phone sign-in in Supabase, then set
`NEXT_PUBLIC_AUTH_PHONE_ENABLED=true`. Phone sign-in is restricted to existing users
(`shouldCreateUser: false`), so collectors must be invited first.
