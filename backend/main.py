import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import auth, superadmin

logger = logging.getLogger("milkflow")

app = FastAPI(title="Milkflow API", version="1.0.0")

# Comma-separated list in .env, e.g. CORS_ORIGINS=http://localhost:3000,https://app.milkflow.co.ke
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Without this, FastAPI returns a plain-text "Internal Server Error" body, which the
    # frontend cannot parse as JSON and reports as a misleading "Network error".
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. Check the API logs."})


app.include_router(auth.router)
app.include_router(superadmin.router)


@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "service": "Milkflow FastAPI Backend"}