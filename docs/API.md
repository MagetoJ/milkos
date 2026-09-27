# API surface

Base path: `/api/v1`

Initial endpoints:
- `GET /health/live`
- `GET /health/ready`
- `POST /cooperatives/applications`
- `POST /collections`
- `POST /collections/reversal-requests`
- `POST /collections/reversal-approvals`

Every route requires a Supabase access token unless it is marked `@Public()`, and business routes declare their permissions with `@RequirePermissions(...)`. See `docs/AUTH.md`.
