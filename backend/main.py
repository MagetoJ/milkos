from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import models.cooperative
import models.user
import models.admin
from routers import auth, superadmin

# The schema is managed by Alembic (`alembic upgrade head`), never created at startup.

app = FastAPI(title="MilkOS API")

# Explicit origins are required when allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(superadmin.router)
