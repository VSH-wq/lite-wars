"""
Username/password auth. Passwords are hashed with bcrypt before they ever
reach the database. Login issues a JWT that the browser holds onto and
sends back both for REST calls and to open the game WebSocket.
"""
import time

import bcrypt
import jwt

from app import database
from app.config import JWT_ALGO, JWT_EXPIRE_HOURS, JWT_SECRET

USERNAME_MIN, USERNAME_MAX = 3, 20
PASSWORD_MIN = 4


def _valid_username(username: str) -> str | None:
    """Returns an error string, or None if the username is fine."""
    if not (USERNAME_MIN <= len(username) <= USERNAME_MAX):
        return f"Username must be {USERNAME_MIN}-{USERNAME_MAX} characters"
    if not username.isalnum():
        return "Username can only contain letters and numbers"
    return None


async def register_user(username: str, password: str) -> tuple[bool, str | None]:
    username = username.strip()
    err = _valid_username(username)
    if err:
        return False, err
    if len(password) < PASSWORD_MIN:
        return False, f"Password must be at least {PASSWORD_MIN} characters"

    existing = await database.get_user(username)
    if existing:
        return False, "That username is already taken"

    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    await database.create_user(username, pw_hash)
    return True, None


async def login_user(username: str, password: str) -> tuple[str | None, dict | None, str | None]:
    """Returns (token, stats, error)."""
    user = await database.get_user(username.strip())
    if not user:
        return None, None, "Invalid username or password"
    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return None, None, "Invalid username or password"

    payload = {"sub": user["username"], "exp": int(time.time()) + JWT_EXPIRE_HOURS * 3600}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)
    stats = {
        "kills": user["kills"],
        "deaths": user["deaths"],
        "exp": user["exp"],
        "kills_free": user["kills_free"],
        "kills_team": user["kills_team"],
    }
    return token, stats, None


def verify_token(token: str) -> str | None:
    """Returns the username the token belongs to, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
