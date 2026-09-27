# Authentication and access control

Supabase Auth owns credentials, sessions and MFA. MilkOS owns authorization: roles, cooperative memberships and permissions live in our Postgres database and are checked by the API on every request.

## How a request is authorized

1. The web app signs the user in with Supabase (email and password, phone OTP or Google). The session is stored in cookies by `@supabase/ssr`.
2. Every API call sends `Authorization: Bearer <supabase access token>` (`apps/web/lib/api.ts`). When a cooperative is selected it also sends `x-cooperative-id`.
3. `AuthGuard` verifies the token against the project's JWKS (or the legacy HS256 secret), rejects anon and service-role keys, and loads the MilkOS `User` with its active memberships. The first request of a new Supabase user creates that `User` row and accepts pending invitations.
4. `AccessGuard` enforces MFA for privileged roles, resolves the cooperative (route/body/query `cooperativeId`, then the header, then the user's only or default cooperative), proves the caller may act in it, and checks the route's `@RequirePermissions(...)`.
5. `TenantContextInterceptor` runs the handler in a transaction bound to that cooperative so Postgres RLS applies.

`GET /api/v1/auth/me` returns the user, session assurance level, and the permissions they hold in each cooperative. The web app uses it to pick the active cooperative and to show only the pages the user can use. The API remains the source of truth; hiding a link is not a security control.

## Roles

| Role | Scope | Notes |
| --- | --- | --- |
| `PLATFORM_SUPER_ADMIN` | Platform | Everything, in every cooperative |
| `PLATFORM_ADMIN` | Platform | Reviews applications and payments, read-only inside cooperatives |
| `PLATFORM_SUPPORT` | Platform | Read-only |
| `COOPERATIVE_MANAGER` | Cooperative | Everything inside their cooperative |
| `ACCOUNTANT` | Cooperative | Pricing, SMS purchases, reports, audit |
| `COLLECTOR` | Cooperative | Records collections, requests corrections and reversals |
| `FARMER` | Cooperative | Cooperative profile only, for now |

The permission map is `apps/api/src/auth/permissions.ts`. Platform staff, managers and accountants must hold an `aal2` session (authenticator app) unless `AUTH_REQUIRE_MFA=false`.

## Setting up Supabase

1. Create a project (or run `supabase start` for the local stack at `http://127.0.0.1:54321`).
2. Copy the values into `.env`:
   - `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`: the project URL.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the publishable (or legacy anon) key. Safe for the browser.
   - `SUPABASE_SERVICE_ROLE_KEY`: server only, used to send invitations and to ban suspended users.
   - `SUPABASE_JWT_SECRET`: only if the project still signs tokens with the legacy shared secret.
3. Authentication → URL configuration: set the Site URL to the web app (`http://localhost:3000` locally) and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` to the redirect allow list (plus the production equivalents).
4. Authentication → Sign In / Providers:
   - Email: enabled. Keep "Confirm email" on.
   - Phone: enable it and connect an SMS provider if applicants and collectors should sign in by phone.
   - Google: add the OAuth client ID and secret, and add `https://<project-ref>.supabase.co/auth/v1/callback` as the authorized redirect URI in Google Cloud.
5. Authentication → Multi-Factor: enable TOTP (app authenticator).
6. Authentication → Email Templates: point the **Invite user** template at our confirm route so invited users can set a password:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a>
   ```

   The other templates can stay as they are: sign-up confirmation and password recovery use PKCE links that land on `/auth/callback`. If you prefer token-hash links everywhere, use `type=signup`, `type=recovery` and `type=magiclink` with the same route.

## Creating the first Platform Super Admin

Platform roles are only granted by an existing super admin, so the first one is created from the command line:

1. Sign in to the web app once with the account (this creates its `User` row).
2. Run, with `DATABASE_URL` pointing at the database:

   ```bash
   npm --workspace apps/api run auth:grant-role -- admin@example.com PLATFORM_SUPER_ADMIN
   ```

3. Sign in again. You will be asked to set up an authenticator app before the admin pages load.

After that, use `POST /api/v1/admin/users/invite` and `PATCH /api/v1/admin/users/:id/platform-role` to manage platform staff, and `POST /api/v1/cooperatives/:id/members` to invite cooperative staff.

## Cooperative onboarding

1. The applicant creates an account and signs in.
2. On **Register cooperative** they enter the cooperative's details and a contact phone. If they signed in with that phone number it is already verified; otherwise the API texts a code (`/cooperatives/registration/verify/*`).
3. `POST /cooperatives/applications` records the signed-in user as the applicant.
4. A platform admin approves it from the admin portal, which activates the cooperative and makes the applicant its `COOPERATIVE_MANAGER`.

## Web routes

| Route | Purpose |
| --- | --- |
| `/login` | Email and password, phone OTP, Google, and account creation |
| `/forgot-password`, `/reset-password` | Password recovery; `/reset-password?invited=1` also finishes an invitation |
| `/auth/callback` | Exchanges OAuth and PKCE email codes for a session |
| `/auth/confirm` | Verifies token-hash email links (invitations) |
| `/mfa` | Enrols or verifies an authenticator app |

`apps/web/proxy.ts` refreshes the session cookie and sends signed-out visitors to `/login?next=…` for every page except `/`, the auth pages and `/applications/status`.
