import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models  # noqa: F401  (registers every table on Base.metadata)
from routers import auth, cooperative, superadmin

# The schema is managed by Alembic (`alembic upgrade head`), never created at startup.

app = FastAPI(title="MilkOS API")

# Explicit origins are required when allow_credentials=True.
# Comma-separated; override with CORS_ORIGINS in backend/.env for any non-local deployment.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(superadmin.router)
app.include_router(cooperative.router)