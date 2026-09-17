# API surface

Base path: `/api/v1`

Initial endpoints:
- `GET /health/live`
- `GET /health/ready`
- `POST /cooperatives/applications`
- `POST /collections`
- `POST /collections/reversal-requests`
- `POST /collections/reversal-approvals`

The production Keycloak guard and permission decorators should be applied before exposing business endpoints beyond the development scaffold.
