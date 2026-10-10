# Accounts, activation and security

MilkOS runs on Next.js + FastAPI + SQLAlchemy + PostgreSQL (Alembic migrations) with its own JWT authentication.
Older specifications that mention NestJS, Prisma or Keycloak do not apply; everything below extends the existing stack.

## Account states (`users.account_status`)

| State | Meaning | Can sign in |
|---|---|---|
| `PENDING_APPROVAL` | Self-registered cooperative applicant awaiting platform review | No |
| `PENDING_ACTIVATION` | Created by an administrator; must open the SMS link and set a password (the "invited" state) | No |
| `ACTIVE` | Normal account | Yes |
| `SUSPENDED` | Temporarily blocked by an administrator | No |
| `DISABLED` | Switched off (reversible; history kept) | No |

`users.is_active` is kept equal to `account_status == ACTIVE` by `User.set_status`, so every existing check keeps
working. Any status other than ACTIVE bumps `session_epoch`, which ends every access token immediately.

## Phone number rule

* Phone numbers are stored in E.164 (`+2547XXXXXXXX` / `+2541XXXXXXXX`); `0712…`, `254712…`, `+254712…` and
  `712…` all normalise to the same value, so they can never create duplicate accounts.
* **One account per phone number across the platform.** The number is a sign-in identifier and the channel for
  activation, verification and password-reset messages, so it must identify exactly one account. Each account
  has exactly one role; a person who is both a farmer and a collector needs two numbers.
* Farmer records (the member register) keep their own phone, unique within a cooperative. When a farmer gets an
  app account it uses the same number, and changing the record's number moves the account's number too
  (unverified until the farmer confirms it).

## Account creation and activation

1. An authorised administrator creates the account (no password field anywhere).
2. The account is `PENDING_ACTIVATION` with no password.
3. A one-time activation token (256-bit random) is generated; only its SHA-256 hash is stored
   (`account_activations`). Issuing a new one revokes older open ones.
4. The SMS carries `<APP_URL>/activate-account#t=<token>`. The token is in the URL fragment, which browsers
   never send to a server, so it never reaches access logs. The stored copy of the SMS has the link replaced.
5. The person opens the link, confirms their phone with a 6-digit code (setting
   `security.activation_requires_otp`, on by default) and sets their own password.
6. The account becomes `ACTIVE`; the token is marked used; the person signs in normally.

Links expire after `security.activation_link_minutes` (default 30). Admins can resend (60 s cooldown) or revoke;
people can request a new link from the activation page (generic answer, rate limited).

## Codes (OTP)

6 digits, HMAC-hashed with the server key and bound to their challenge, valid 10 minutes, 5 wrong attempts,
resend after 60 s, at most 5 sends per challenge. Used for activation and phone changes.

## Passwords

* bcrypt; rules: 8+ characters with upper case, lower case and a digit.
* Administrators never set, see or receive a password. "Reset" sends the person a one-time reset link.
* Password reset (`password_resets`) is a separate table and flow from activation; only ACTIVE accounts get one.
* `must_change_password` is enforced by the backend (`core/access.py`): such an account can only call
  `/api/v1/account/me` and `/api/v1/account/password`.
* Five wrong passwords lock sign-in for 15 minutes.

## Two-step verification

TOTP (RFC 6238, any authenticator app). Secrets are encrypted at rest (Fernet, `MFA_ENCRYPTION_KEY`), recovery
codes are hashed and single-use. Sign-in returns a 5-minute `mfa_token` that is not an access token.

## Sessions

The JWT carries `sv` (the account's `session_epoch`). Changing the password or phone number, signing out other
sessions, suspending or disabling an account, or changing its role bumps the epoch: older tokens stop working
on the next request. Devices with a still-valid offline session silently get a fresh token; revoked ones don't.

## SMS

Security messages use the existing provider interface and notification lifecycle. Messages for a cooperative's
accounts are charged to its SMS credit ledger (reserve → consume, refunded on failure); messages triggered by
platform staff, or for platform accounts, are billed to the platform. "Sent" means the provider accepted the
message; "Delivered" appears only when the provider's delivery report confirms it
(`SMS_DELIVERY_REPORT_TOKEN`). Messages containing a link or code are never retried automatically: a new link or
code is issued instead.

## Security events

Recorded in the existing `audit_logs` table with `entity_type = "security"` (sign-ins, failures, lockouts,
activation steps, password and phone changes, MFA, session revocation, status and role changes, device
registration). Passwords, codes, tokens and JWTs are never written.

## Offline

Profile and preferences are cached in IndexedDB (meta database) with every secret-bearing key stripped. Password,
phone, code, MFA, session and role operations are online-only and are disabled, never queued, without a connection.

## External dependencies

* **SMS provider** (`SMS_PROVIDER=africastalking|webhook`). Without one, activation SMS stay `PENDING_PROVIDER`
  and are reported as not sent.
* **Delivery reports** need the provider's callback URL configured with `SMS_DELIVERY_REPORT_TOKEN`.
* **Profile pictures and cooperative logos** need object storage, which is not configured.
* **Real scales**: a hardware adapter can be registered once a scale model's Bluetooth protocol is verified on
  the device (`lib/scale/registry.ts`). Until then collectors use the simulator (development) or manual entry.
* **Rate limiting** on public endpoints is per API worker; put a shared limiter in front for strict limits.
