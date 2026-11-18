"""Native Android Google OAuth using Authorization Code + PKCE.

Database operations and OAuth business rules live here; the API router
only handles HTTP requests, rate limits and redirects.
"""
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.security import (
    access_token_for,
    generate_token,
    hash_token,
)
from app.domain.exceptions import InvalidRequest
from app.infrastructure.db.models.native_oauth import NativeOAuthTransaction
from app.infrastructure.db.models.user import User
from app.infrastructure.gateways import google_oauth
from app.services import authentication
from app.services import mfa as mfa_service

logger = logging.getLogger(__name__)

NATIVE_OAUTH_TTL_SECONDS = 600
NATIVE_TICKET_TTL_SECONDS = 120
ONBOARDING_TOKEN_TTL_SECONDS = 1200


def create_onboarding_token(email: str, name: str) -> str:
    """Encrypt a short-lived Google identity payload for COOP_ADMIN onboarding."""
    payload = {
        "purpose": "google_coop_admin_signup",
        "email": email.strip().lower(),
        "name": name.strip(),
        "exp": int((datetime.utcnow() + timedelta(seconds=ONBOARDING_TOKEN_TTL_SECONDS)).timestamp()),
    }
    return mfa_service.encrypt(json.dumps(payload))


def verify_onboarding_token(token: str) -> dict[str, str]:
    """Decrypt and validate a Google COOP_ADMIN onboarding token."""
    try:
        raw = mfa_service.decrypt(token)
        if not raw:
            raise InvalidRequest("Google sign-up session is invalid. Please try again.")
        payload = json.loads(raw)
    except InvalidRequest:
        raise
    except Exception as exc:
        raise InvalidRequest("Google sign-up session is invalid. Please try again.") from exc

    if payload.get("purpose") != "google_coop_admin_signup" or not payload.get("email"):
        raise InvalidRequest("Invalid Google sign-up token.")

    exp = int(payload.get("exp") or 0)
    if datetime.utcnow().timestamp() > exp:
        raise InvalidRequest("Your Google sign-up session expired. Please click Sign up with Google again.")

    return {
        "email": str(payload["email"]).strip().lower(),
        "name": str(payload.get("name") or "").strip(),
    }


def start(db: Session, intent: str = "login") -> dict:
    """Create a short-lived PKCE transaction and return Google's consent URL."""
    raw_state = google_oauth.generate_state()
    state = f"signup.{raw_state}" if intent == "signup" else raw_state
    verifier, challenge = google_oauth.generate_pkce_pair()

    # Validate OAuth configuration before persisting a transaction.
    authorization_url = google_oauth.native_consent_url(
        state=state,
        code_challenge=challenge,
    )

    now = datetime.utcnow()
    transaction = NativeOAuthTransaction(
        state_hash=hash_token(state),
        pkce_verifier_encrypted=mfa_service.encrypt(verifier),
        expires_at=now + timedelta(seconds=NATIVE_OAUTH_TTL_SECONDS),
    )
    db.add(transaction)
    db.commit()

    return {"authorization_url": authorization_url}


async def callback(db: Session, code: str | None, state: str | None) -> dict:
    """Consume OAuth state, verify Google identity and issue a ticket or onboarding token."""
    if not code or not state:
        return {"error": "google_signin_cancelled"}

    is_signup = state.startswith("signup.")
    state_hash = hash_token(state)
    now = datetime.utcnow()

    # Atomic state consumption prevents callback replay.
    consumed = db.execute(
        update(NativeOAuthTransaction)
        .where(
            NativeOAuthTransaction.state_hash == state_hash,
            NativeOAuthTransaction.state_used_at.is_(None),
            NativeOAuthTransaction.expires_at > now,
        )
        .values(state_used_at=now)
    )

    if consumed.rowcount != 1:
        db.rollback()
        return {"error": "invalid_or_expired_state"}

    # Commit before contacting Google: a failed exchange must not make
    # the same state reusable.
    db.commit()

    transaction = (
        db.query(NativeOAuthTransaction)
        .filter(NativeOAuthTransaction.state_hash == state_hash)
        .first()
    )
    if transaction is None:
        return {"error": "oauth_transaction_not_found"}

    try:
        verifier = mfa_service.decrypt(transaction.pkce_verifier_encrypted)
        if not verifier:
            return {"error": "google_signin_failed"}

        profile = await google_oauth.profile_for_native_code(
            code=code,
            code_verifier=verifier,
        )
        email = profile["email"]

        # New Google account during Cooperative Admin Sign-Up -> route to onboarding form
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user is None and is_signup:
            onboarding_token = create_onboarding_token(email=email, name=profile["name"])
            return {
                "onboarding_token": onboarding_token,
                "email": email,
                "name": profile["name"],
            }

        # Existing account (approved COOP_ADMIN, pending application, or coop-created user)
        sign_in = authentication.google_login(db, email)

    except google_oauth.GoogleAuthError:
        db.rollback()
        return {"error": "google_signin_failed"}
    except Exception:
        db.rollback()
        logger.exception("Native Google OAuth failed")
        return {"error": "google_signin_failed"}

    # Google identity does not bypass the account's second factor.
    if sign_in.token is None:
        return {"mfa_required": "1"}

    # Store only a hash of the short-lived, single-use exchange ticket.
    ticket = generate_token()
    now = datetime.utcnow()

    db.execute(
        update(NativeOAuthTransaction)
        .where(NativeOAuthTransaction.id == transaction.id)
        .values(
            ticket_hash=hash_token(ticket),
            user_id=sign_in.user.id,
            expires_at=now + timedelta(seconds=NATIVE_TICKET_TTL_SECONDS),
        )
    )
    db.commit()

    return {"ticket": ticket}


def exchange(db: Session, ticket: str) -> dict:
    """Consume a one-time ticket and return the normal MilkOS access token."""
    now = datetime.utcnow()
    ticket_hash = hash_token(ticket)

    # Atomic consumption prevents replay, including concurrent requests.
    consumed = db.execute(
        update(NativeOAuthTransaction)
        .where(
            NativeOAuthTransaction.ticket_hash == ticket_hash,
            NativeOAuthTransaction.ticket_used_at.is_(None),
            NativeOAuthTransaction.expires_at > now,
            NativeOAuthTransaction.user_id.is_not(None),
        )
        .values(ticket_used_at=now)
    )

    if consumed.rowcount != 1:
        db.rollback()
        raise InvalidRequest(
            "This sign-in ticket is invalid, expired, or already used."
        )

    transaction = (
        db.query(NativeOAuthTransaction)
        .filter(NativeOAuthTransaction.ticket_hash == ticket_hash)
        .first()
    )
    if transaction is None or transaction.user_id is None:
        db.rollback()
        raise InvalidRequest("This sign-in ticket is invalid.")

    user = db.get(User, transaction.user_id)
    if user is None:
        db.rollback()
        raise InvalidRequest("The account could not be found.")

    # Consume the ticket before returning credentials.
    token = access_token_for(user)
    result = {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role_value,
        "user_id": str(user.id),
        "must_change_password": bool(user.must_change_password),
    }
    db.commit()
    return result
