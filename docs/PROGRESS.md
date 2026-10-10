# MilkOS progress

Source of truth: the UI/UX spec. **`docs/UI_UX_Spec.pdf` is not in the repo.** A candidate exists outside it
(`~/Downloads/Milk Collection Platform UI UX System Requirements.pdf`); its identity is awaiting confirmation.
No spec-section status below is claimed until the spec is confirmed.

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

## Pages already present (found while verifying; not yet verified against spec)
`/forgot-password`, `/reset-password`, `/activate-account`, `/application-status`, `/change-password`,
`/cooperatives/settings`, `/superadmin/settings/account`, and a `/farmer` portal
(dashboard, collections, collections/[id], payments, profile, settings).
