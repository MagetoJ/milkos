# MilkOS progress

Source of truth: `docs/UI_UX_Spec.pdf` (copied from `~/Downloads/Milk Collection Platform UI UX System Requirements.pdf`;
its section numbers match the ones used in the brief, but the user has not explicitly confirmed it is the intended file).
There was no gap-analysis file to start from; this one was created in Phase 0.

## Phase 0: baseline (2026-10-10)

| Check | Result |
|---|---|
| Files "missing" from imports (`routers/account.py`, `routers/farmer.py`, `services/{accounts,mfa,security_events,preferences}.py`, `core/ratelimit.py`, `lib/account/api.ts`, `lib/hooks/use-sidebar.ts`, `components/accounts/account-status.tsx`) | Not missing: they were **untracked in the working tree**, never in git history. Nothing reimplemented; committed as-is (80c31a4). |
| `pnpm install --frozen-lockfile` | Pass (node_modules had to be recreated; it was built by another pnpm layout) |
| `pnpm typecheck` | Was 1 error (`lib/collections/batch-client.ts` `masked()` call on an indexed `Row`). Fixed. Pass |
| `pnpm lint` | 0 errors, 27 warnings (mostly `react-hooks/set-state-in-effect`, `no-location-assign-relative-destination`). Not yet cleaned. |
| `pnpm test` | Was 1 failing of 62: `collector-workflow` allocated 60 of 100 kg. Backend, `draft.ts` and the rule agree that allocation must equal the captured weight exactly, so the **test** was wrong. Fixed. 62/62 pass |
| `pnpm build` | Pass |
| `pytest` (backend, SQLite) | 241 passed |
| `pytest` against PostgreSQL | Not run locally (no instance); runs in CI |
| CI | `.github/workflows/ci.yml` added (3c2c04e). Not yet run on GitHub. |

## Phase 1: missing screens and routes

| Spec | Item | Status | Evidence |
|---|---|---|---|
| §40 | `/forgot-password`, `/reset-password`, `/activate-account`, `/application-status`, `/change-password`, `/cooperatives/settings`, `/superadmin/settings/account` | **Done (already existed, untracked; now committed and verified)** | All return 200 from `next start`; every endpoint they call exists in `routers/auth.py` / `routers/account.py` |
| §15 | Farmer portal: Today's Milk, **This Month** (added), Recent Collections, history, detail (date, time, cooler, quantity, price, status, receipt), profile | **Done** | `app/farmer/*`; `this_month` in `GET /api/v1/farmer/dashboard`; `test_this_month_is_calendar_month_to_date_whatever_the_range` |
| §15 | Server-side "farmers see only their own data" | **Done, tested** | `backend/tests/test_farmer_isolation.py` (6 tests): list, detail, dashboard, payments, prices; same-cooperative and cross-cooperative, both directions; tampered `farmer_id`/`cooperative_id` params ignored; unlinked farmer login and other roles refused. Mutation-checked: removing the ownership filter fails 3 of them. |
| §41 | Public application: headline, explanation, progress, field labels | **Done (extra fields kept by decision)** | `app/(auth)/register`, `register-form.tsx`, `tests/frontend/application-form.test.ts`. **Decided (option A, kept as is):** §41 lists 8 fields; the form still has registration number, county, litres/day, cooler count and a password (backend `/auth/register` requires them). Not removed without a decision. |

Defects found and fixed along the way
- The application success screen never showed the application reference, but `/application-status` requires it and nothing else sends it (`core/notifications.py` only logs). Now shown with a copy button and a prefilled status link.
- Empty "confirm password" counted as valid (`'' === ''`).
- `/application-status` was briefly server-rendered empty (Suspense); now a server component reading `searchParams`.

Noted, not yet fixed
- The login page is branded "Milkflow Portal" and some copy says "Milkflow"; the product is MilkOS (Phase 5 clean-up).
- The login page says approval is by "Superadmin"; applicants are told the MilkOS team.
- Applicant notifications (received/approved/rejected) are logged only; no email/SMS is sent.

## Phase 2: shell, context and navigation

| Spec | Item | Status | Evidence |
|---|---|---|---|
| §6, §35 | Cooperative desktop menu grouped Overview / Operations / Finance / Reporting / Management / Governance, filtered by permission | **Done** | `app/cooperatives/_components/nav.ts` (`coopNav`), `lib/permissions.json` mirrors `core/permissions.py`; `backend/tests/test_permissions_mirror.py`, `tests/frontend/shell.test.ts` |
| §6 | Platform-admin (superadmin) menu | **Not changed** | Already grouped (`admin-shell.tsx`) but not to the §6 names; the §6 Management items "Roles & Permissions" and "Applications" are platform concepts with no coop screen. Revisit with the Security Events screen in Phase 4. |
| §6 | Spec items with no screen yet: Collectors (own page), Exports, Scale Devices, Reversals (own page), Audit Logs / Security Events (cooperative side) | **Not done** | Collectors live inside Team / "Coolers & collectors"; reversals inside "Corrections & reversals"; Exports/Scale Devices are Phase 4 |
| §7 | Cooperative context (name / logo, code, place, status) and cooler context (name, place, status), top bar on desktop, header on mobile, cooler switching | **Done for cooler; cooperative is display-only** | `components/shell/context-switchers.tsx`, `lib/hooks/use-working-cooler.ts` |
| §7 | Switching between cooperatives | **Not done (needs a decision)** | A user belongs to exactly one cooperative (`users.cooperative_id`); there is no multi-membership model. Cooperatives have no logo column, so initials are shown. |
| §16, §34 | Collector tabs Home / Collections / Farmers / Sync / **More**; "+ New Collection" one tap from every screen | **Done** | `collector-shell.tsx`, `app/collector/more/page.tsx`; Home keeps its dominant button, the wizard is the flow itself |
| §17 | Quick actions New Farmer, Add Collector, Add Cooler, Set Monthly Price, Buy SMS Credits | **Done** | `quick-actions.tsx`, `use-open-from-link.ts` (`?new=`); admin sees all five, a manager only "New farmer" per the permission table |

Behaviour notes
- The working cooler only decides what the header shows and which cooler is pre-selected for a new collection. The collection wizard still starts at the cooler step on every collection and the server validates the cooler against the cooperative.
- Navigation filtering hides links only; every action is still authorised by the backend.

Not verified
- The signed-in shells were not looked at in a browser (no seeded session available); verified by typecheck, 92 frontend tests, a production build, and the routes returning 200. A visual/responsive pass is part of Phase 5.

## Backend restructure: layered `backend/app/` (2026-10-20)

Layout and rules: `backend/app/README.md`. Entry point is now `uvicorn app.main:app` (`backend/Dockerfile` updated).

| Item | Status | Evidence |
|---|---|---|
| Move `core/`, `db.py`, `models/`, `schemas/`, `services/`, `routers/`, `main.py` into `app/{api,services,domain,infrastructure,core}` | **Done** | `git mv` (history kept); every import rewritten |
| Domain interfaces: SMS, payments, tasks, repositories; domain exceptions | **Done** | `app/domain/` |
| Services free of FastAPI (domain exceptions instead of `HTTPException`; `api/errors.py` maps them, same bodies) | **Done** | `tests/test_architecture.py` |
| Routers free of database access (queries moved into services; `services/platform_admin/` for the superadmin console) | **Done** | `tests/test_architecture.py::test_routers_do_not_touch_the_database` |
| Dependencies in `app/api/dependencies/` (db, auth, pagination, tasks, feature gate); `core.access -> routers.auth` import cycle removed | **Done** | |
| Tenant-scoped repository behind `own()` (another cooperative's row is a 404) | **Done** | `SqlTenantRepository`, test in `test_architecture.py` |
| Background tasks: receipt SMS after batch confirm, SMS after sync push and alert housekeeping on sync status run after the response | **Done** | `app/infrastructure/tasks`, `app/services/background.py` |
| Feature gate placeholder (`require_feature`) | **Done, not applied to any endpoint** | Every cooperative has every feature until plans exist |
| API contract unchanged | **Verified** | OpenAPI from before and after: 153 paths, 176 operations, 79 schemas identical; only 3 endpoint descriptions reworded |
| `pytest` (SQLite) | **261 passed** (249 existing + 12 new) | |

Behaviour changes
- `POST /api/v1/collection-batches` returns before the receipt SMS are sent, so its response shows each line's receipt
  as `PENDING`. The app already labels that as waiting (`lib/collections/receipts.ts`) and updates when the result
  syncs; the batch detail endpoint shows the outcome. SMS whose result is part of a response (sign-in and phone codes,
  activation links) are still sent synchronously.
- `GET /api/v1/sync/status` raises stale-cooler alerts and retries due SMS after responding instead of before.
- A few 401/403 responses now carry `WWW-Authenticate: Bearer` / `X-Error-Code` headers they previously lacked.

Not verified
- `pytest` against PostgreSQL (no local instance; runs in CI).
- The Docker image was not rebuilt.
