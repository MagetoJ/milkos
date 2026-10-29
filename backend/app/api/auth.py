from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests
import os

router = APIRouter()

GOOGLE_CLIENT_ID = os.getenv("1075007375213-43loar2rqfqn6ech60f7tviu5cbi4a4p.apps.googleusercontent.com")

class GoogleAuthRequest(BaseModel):
    id_token: str

@router.post("/api/v1/auth/google")
def google_login(payload: GoogleAuthRequest):
    try:
        # Verify the ID token with Google's public keys
        id_info = id_token.verify_oauth2_token(
            payload.id_token, 
            requests.Request(), 
            GOOGLE_CLIENT_ID
        )

        email = id_info.get("email")
        name = id_info.get("name")
        picture = id_info.get("picture")

        # Find or create user in PostgreSQL DB here
        # user = get_or_create_user(db, email=email, name=name)

        # Generate Milkos JWT Access Token
        # access_token = create_access_token(data={"sub": user.id})

        return {
            "access_token": "YOUR_JWT_TOKEN",
            "token_type": "bearer",
            "user": {"email": email, "name": name, "picture": picture}
        }

    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Google Token")