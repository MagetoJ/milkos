"""HTTP middleware installed on the application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config


def install_middleware(app: FastAPI) -> None:
    ngrok_origins = [
        "https://framing-unreeling-relax.ngrok-free.dev",
        "https://*.ngrok-free.dev",
    ]
    origins = list(dict.fromkeys(config.CORS_ORIGINS + ngrok_origins))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
