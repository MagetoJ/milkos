"""HTTP middleware installed on the application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config


def install_middleware(app: FastAPI) -> None:
    # Override CORS_ORIGINS in backend/.env for any non-local deployment.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
