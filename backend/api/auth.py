"""
Auth API for SKC
POST /auth/login        — username + password → JWT
POST /auth/google       — Google OAuth code  → JWT
GET  /auth/me           — verify token, return user info
POST /auth/logout       — (stateless, client just drops the token)

Add to main.py:
    from api.auth import router as auth_router
    app.include_router(auth_router, prefix="/auth", tags=["Auth"])

Protect other routes by adding `user: dict = Depends(require_auth)` to any
endpoint that should be gated.
"""

import os
import logging
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import jwt                        # pip install PyJWT
import requests as http_requests  # pip install requests (already present for Slack)

logger = logging.getLogger(__name__)
router = APIRouter()
bearer = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# Config — set these in .env
# ---------------------------------------------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-to-a-long-random-string")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 7       # 7 days

# Users — stored here for simplicity; move to DB for production
# Password is stored as sha256 hex. Set yours in .env:
#   AUTH_USERNAME=admin
#   AUTH_PASSWORD_HASH=<sha256 of your password>
# To generate: python -c "import hashlib; print(hashlib.sha256(b'yourpassword').hexdigest())"
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD_HASH = os.getenv(
    "AUTH_PASSWORD_HASH",
    hashlib.sha256(b"skc-admin-2024").hexdigest(),  # default password: skc-admin-2024
)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:5173/auth/callback")

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_token(username: str, email: str = "", avatar: str = "") -> str:
    payload = {
        "sub": username,
        "email": email,
        "avatar": avatar,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token.")


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    """FastAPI dependency — add to any endpoint that needs auth."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return decode_token(credentials.credentials)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

class GoogleCallbackRequest(BaseModel):
    code: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    email: str = ""
    avatar: str = ""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    """Username + password login."""
    # Constant-time comparison to prevent timing attacks
    username_ok = hmac.compare_digest(req.username.lower(), AUTH_USERNAME.lower())
    pw_hash = hashlib.sha256(req.password.encode()).hexdigest()
    password_ok = hmac.compare_digest(pw_hash, AUTH_PASSWORD_HASH)

    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = create_token(username=AUTH_USERNAME)
    return TokenResponse(access_token=token, username=AUTH_USERNAME)


@router.get("/google/url")
def google_oauth_url():
    """Return the Google OAuth URL to redirect the user to."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env.")
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        "&response_type=code"
        "&scope=openid%20email%20profile"
        "&access_type=offline"
    )
    return {"url": url}


@router.post("/google/callback", response_model=TokenResponse)
def google_callback(req: GoogleCallbackRequest):
    """Exchange Google OAuth code for a JWT."""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=500, detail="Google OAuth not configured.")

    # Exchange code for tokens
    token_resp = http_requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": req.code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
    )
    token_data = token_resp.json()
    if "error" in token_data:
        raise HTTPException(status_code=400, detail=f"Google OAuth error: {token_data['error']}")

    # Get user info
    userinfo_resp = http_requests.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {token_data['access_token']}"},
    )
    userinfo = userinfo_resp.json()
    email = userinfo.get("email", "")
    name = userinfo.get("name", email)
    avatar = userinfo.get("picture", "")

    token = create_token(username=name, email=email, avatar=avatar)
    return TokenResponse(access_token=token, username=name, email=email, avatar=avatar)


@router.get("/me")
def get_me(user: dict = Depends(require_auth)):
    """Return current user info from token."""
    return {
        "username": user.get("sub"),
        "email": user.get("email", ""),
        "avatar": user.get("avatar", ""),
    }


@router.post("/logout")
def logout():
    """Stateless logout — client should delete the token."""
    return {"message": "Logged out. Delete the token on the client."}