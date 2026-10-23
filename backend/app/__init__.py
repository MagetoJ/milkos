"""MilkOS backend, layered (being migrated in from the top-level packages; see app/README.md).

    api/             FastAPI routers, request/response models, dependencies. Translates domain errors to HTTP.
    services/        Business rules and workflows. No FastAPI imports.
    domain/          Contracts the services depend on: interfaces, exceptions. No FastAPI, no SQLAlchemy sessions.
    infrastructure/  Implementations of those contracts: database, SMS/payout gateways, task dispatch.
    core/            Settings, security primitives (JWT, hashing), middleware.

Imports point downwards only: api -> services -> domain <- infrastructure.
"""
