# MilkOS backend layout

```
app/
  main.py              the ASGI app: uvicorn app.main:app
  api/                 HTTP only
    routers/           endpoints; superadmin/ is the platform console
    dependencies/      db session, auth (Principal, permissions), pagination, tasks
    errors.py          domain exceptions -> HTTP status and body
    cookies.py         the session cookie
  services/            business rules and workflows (no FastAPI)
    platform_admin/    SUPER_ADMIN cross-cooperative views and decisions
    sync/              offline push, pull and devices
    background.py      task handlers (SMS delivery, alert housekeeping)
    principal.py       Principal: who is calling; tenant scoping (own(), get_or_404(), cooperative_scope())
    features.py        which features a cooperative's plan includes
  domain/              contracts: interfaces, exceptions, request/response schemas (Pydantic)
  infrastructure/
    db/                engine and Base, ORM models, pagination, ORM listeners
    gateways/          SMS (Africa's Talking, webhook), payouts, Google OAuth
    tasks/             task registry and dispatchers
    exports/           XLSX writer
  core/                config, security (JWT, hashing), permissions, validation, rate limit, middleware,
                       client address (client.py), small helpers (utils.py: parse_uuid, optional_uuid...)
```

## Rules

Imports point down: `api -> services -> domain <- infrastructure`, and every layer may use `core`.
`tests/test_architecture.py` checks these:

- `services`, `domain`, `infrastructure` and `core` never import `app.api`.
- `services`, `domain` and `infrastructure` don't import FastAPI. The exception is the in-process task dispatcher,
  which is built on FastAPI's `BackgroundTasks`.
- `domain` imports nothing from `services`, `infrastructure`, `api` or SQLAlchemy.
- Routers never touch the session (`db.query`, `db.commit`...). They parse the request, call a service and shape
  the response.

## Errors

Services raise `app.domain.exceptions` (`NotFound`, `Conflict`, `ValidationFailed`, `PermissionDenied`...), never
`HTTPException`. `api/errors.py` maps each class to its status code. A message tied to a field (or an explicit `loc`)
is sent in FastAPI's validation-error shape, so forms show it next to the field. `code=` becomes the `X-Error-Code`
header. `core.utils.field_error()` and `conflict()` build these exceptions.

## Tenant isolation

The cooperative always comes from the caller's account (`Principal`), never from the request.

- Load a row by id with `own(db, principal, Model, raw_id, "What")`, or `get_or_404(db, Model, raw_id, "What")` in
  the platform console. Both are in `app.services.principal`. Another cooperative's row is a 404, exactly like a
  missing one.
- An endpoint that only works inside a cooperative calls `principal.require_tenant()`, which refuses platform staff.
- Optional id query parameters are parsed with `optional_uuid(value, "What")`: a malformed id is a 404, as before.

## Background work

Work that doesn't have to finish before the response goes through a `TaskDispatcher`. Routers get one with
`Depends(get_tasks)`; services receive it as a parameter. Use it for SMS receipts after a batch is confirmed, SMS
after a sync push, and alert housekeeping on sync status.

- Handlers are registered with `@task("name")` in `services/background.py`. That module is imported by
  `api/dependencies/tasks.py`, which is what makes the handlers known.
- Payloads must be JSON-serialisable (ids, not ORM objects). Each task opens its own session.
- Delivery state lives in the `notifications` table, so a task that never runs is picked up by the next
  `dispatch_due`.

To move tasks to Celery/Redis, add a dispatcher whose `enqueue` publishes `(task, payload)`, and a worker that
calls `infrastructure.tasks.run`. Callers don't change.

Not everything should be deferred. When the response reports whether an SMS went (a sign-in code, an activation
link), the send stays synchronous through `accounts.dispatch`.

## Gateways

`domain/interfaces` defines `SMSGatewayInterface` and `PaymentGatewayInterface`. They are Protocols, so an
implementation (or a test fake) only needs the right methods; it doesn't have to inherit. Implementations live in
`infrastructure/gateways/<kind>/` and are chosen from the environment in that package's `get_provider()`.
The SMS package's `set_provider()` swaps one in for tests.

## Configuration

`core/config.py` reads start-up settings once: `DATABASE_URL`, `SECRET_KEY`, `BCRYPT_ROUNDS`, `APP_URL`,
`CORS_ORIGINS`, `COOKIE_SECURE` and `LOG_LEVEL`. Operational settings that can change while the server is running
are read where they are used, and gateway credentials are read by their gateway.
