"""HTTP middleware installed on the application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config


def install_middleware(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys(config.CORS_ORIGINS)),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Error-Code", "WWW-Authenticate"],
    )
