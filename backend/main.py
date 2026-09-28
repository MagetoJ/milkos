from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from routers import auth, superadmin




app = FastAPI(title="Milkflow API", version="1.0.0")

# Allow CORS requests from Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(superadmin.router)

class AuthRequest(BaseModel):
    email: str
    password: str

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "service": "Milkflow FastAPI Backend"}

@app.post("/api/v1/auth/login")
def login(data: AuthRequest):
    # Replace with actual DB query / hashing logic (e.g. SQLModel / SQLAlchemy)
    if data.email == "admin@milkflow.com" and data.password == "password123":
        return {"success": True, "token": "fake-jwt-token", "role": "ADMIN"}
    return {"success": False, "error": "Invalid credentials"}