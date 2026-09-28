from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "service": "Milkflow FastAPI Backend"}
