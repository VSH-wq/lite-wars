import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import auth, database
from app.config import JWT_SECRET
from app.game_state import RESPAWN_SECONDS, RoomManager
from app.leveling import progress_in_level
from app.maps import WORLD_SIZE
from app.ratelimit import RateLimiter
from app.vehicles import VEHICLES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("frontline.main")

BASE_DIR = Path(__file__).resolve().parent.parent

room_manager = RoomManager()
_background_tasks: list[asyncio.Task] = []

# Two separate limiters, not one shared bucket:
#  - per-IP is a generous backstop against a single source spraying the
#    endpoints at all (register spam, credential-stuffing across many
#    accounts). It's intentionally loose, because one IP can legitimately
#    be many different people - NAT, a mobile carrier, an office network.
#    A tight per-IP limit means those people share one budget and start
#    429'ing each other, which is a real failure mode, not a theoretical
#    one (a handful of unrelated accounts registering/logging in back to
#    back is completely ordinary behind a shared IP).
#  - per-USERNAME is the actual brute-force protection: it caps attempts
#    against one specific account regardless of how many other people
#    happen to share an IP with the attempt.
ip_limiter = RateLimiter(max_attempts=30, window_seconds=300)
login_account_limiter = RateLimiter(max_attempts=10, window_seconds=900)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if JWT_SECRET == "dev-only-secret-change-me":
        logger.warning(
            "JWT_SECRET is still the insecure default - set a real value "
            "before this is reachable from the internet."
        )
    await database.init_pool()
    await database.init_schema()
    _background_tasks.append(asyncio.create_task(room_manager.run_forever()))
    _background_tasks.append(asyncio.create_task(room_manager.run_stat_flusher()))
    logger.info("startup complete")
    yield
    for task in _background_tasks:
        task.cancel()
    await database.close_pool()


app = FastAPI(title="Frontline Arena", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/")
async def index():
    return FileResponse(str(BASE_DIR / "index.html"))


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/vehicles")
async def get_vehicles():
    return VEHICLES


def _bearer_username(request: Request) -> str:
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip() if header.startswith("Bearer ") else header.strip()
    username = auth.verify_token(token) if token else None
    if not username:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return username


@app.get("/api/me")
async def me(request: Request):
    username = _bearer_username(request)
    user = await database.get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "username": user["username"],
        "kills": user["kills"],
        "deaths": user["deaths"],
        "kills_free": user["kills_free"],
        "kills_team": user["kills_team"],
        **progress_in_level(user["exp"]),
    }


@app.get("/api/leaderboard")
async def leaderboard():
    rows = await database.get_leaderboards(limit=10)
    return {
        "level": [
            {"username": r["username"], **progress_in_level(r["exp"])} for r in rows["level_rows"]
        ],
        "kills_overall": [{"username": r["username"], "value": r["kills"]} for r in rows["overall_rows"]],
        "kills_team": [{"username": r["username"], "value": r["kills_team"]} for r in rows["team_rows"]],
        "kills_free": [{"username": r["username"], "value": r["kills_free"]} for r in rows["free_rows"]],
        "kd_ratio": [
            {"username": r["username"], "value": round(r["kd"], 2), "kills": r["kills"], "deaths": r["deaths"]}
            for r in rows["kd_rows"]
        ],
    }


class AuthBody(BaseModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


@app.post("/api/register")
async def register(body: AuthBody, request: Request):
    if not ip_limiter.check(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts from this network - try again in a few minutes")
    ok, err = await auth.register_user(body.username, body.password)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@app.post("/api/login")
async def login(body: AuthBody, request: Request):
    if not ip_limiter.check(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many attempts from this network - try again in a few minutes")
    if not login_account_limiter.check(body.username.strip()):
        raise HTTPException(status_code=429, detail="Too many attempts on this account - try again later")
    token, stats, err = await auth.login_user(body.username, body.password)
    if err:
        raise HTTPException(status_code=401, detail=err)
    return {
        "token": token,
        "username": body.username.strip(),
        "kills": stats["kills"],
        "deaths": stats["deaths"],
        "kills_free": stats["kills_free"],
        "kills_team": stats["kills_team"],
        **progress_in_level(stats["exp"]),
    }


@app.websocket("/ws/game")
async def ws_game(websocket: WebSocket, token: str, mode: str, vehicle: str):
    # Accept first, THEN validate. A close() before accept() gets turned into
    # a raw HTTP 403 at the handshake level, which a browser WebSocket client
    # can't read a custom close code from (JS only sees a generic abnormal
    # closure). Accepting first means validation failures arrive as a real
    # close frame with our code, which the client's onclose handler can act on.
    await websocket.accept()

    username = auth.verify_token(token)
    if not username:
        await websocket.close(code=4001)
        return
    if mode not in ("free", "team"):
        await websocket.close(code=4002)
        return
    if vehicle not in VEHICLES:
        await websocket.close(code=4003)
        return

    user_row = await database.get_user(username)
    base_exp = user_row["exp"] if user_row else 0

    room = room_manager.get_room(mode)
    player = room.add_player(username, vehicle, websocket, base_exp=base_exp)
    map_def = room.map_def

    await websocket.send_json({
        "type": "welcome",
        "id": player.id,
        "team": player.team,
        "spawn": {"x": player.x, "y": player.y},
        "world_size": WORLD_SIZE,
        "obstacles": map_def["obstacles"],
        "map_name": map_def["name"],
        "map_theme": map_def["theme"],
        "vehicles": VEHICLES,
        "respawn_seconds": RESPAWN_SECONDS,
    })

    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "input":
                room.apply_input(
                    player.id,
                    data.get("mx", 0),
                    data.get("my", 0),
                    data.get("aim", 0),
                    data.get("firing", False),
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("unexpected error in ws loop for %s", username)
    finally:
        if any((
            player.session_kill_delta, player.session_death_delta, player.session_exp_delta,
            player.session_kills_free_delta, player.session_kills_team_delta,
        )):
            try:
                await database.flush_stats(
                    player.username, player.session_kill_delta, player.session_death_delta,
                    player.session_exp_delta, player.session_kills_free_delta, player.session_kills_team_delta,
                )
            except Exception:
                logger.exception("failed to flush final stats for %s on disconnect", player.username)
        room.remove_player(player.id)
