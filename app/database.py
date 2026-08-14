"""
The only thing that ever touches Postgres is: accounts, and the
lifetime progression attached to each account (EXP, kills/deaths,
kills split by mode).

Live match state (positions, projectiles, in-match HP) never comes near
the database - it lives entirely in memory in game_state.py. A round
trip to Postgres on every physics tick would be far too slow, and there's
no need to persist state nobody needs after the match ends.

We use asyncpg directly with hand-written SQL rather than an ORM: the
schema is one table, so an ORM would add a dependency and a learning
curve without buying anything back.
"""
import logging

import asyncpg

from app.config import DATABASE_URL

logger = logging.getLogger("frontline.database")

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in "
            "your Neon connection string (see README for how to get one)."
        )
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def init_schema() -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(20) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                kills INTEGER NOT NULL DEFAULT 0,
                deaths INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        # Additive, idempotent migrations - safe to run on every boot. An
        # already-deployed database (running the earlier version of this
        # app) upgrades itself automatically on the next restart, with no
        # manual migration step and no risk to existing accounts.
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS exp INTEGER NOT NULL DEFAULT 0")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS kills_free INTEGER NOT NULL DEFAULT 0")
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS kills_team INTEGER NOT NULL DEFAULT 0")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_exp ON users (exp DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_kills ON users (kills DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_kills_team ON users (kills_team DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_kills_free ON users (kills_free DESC)")
    logger.info("schema ready")


async def get_user(username: str):
    async with _pool.acquire() as conn:
        return await conn.fetchrow(
            "SELECT username, password_hash, kills, deaths, exp, kills_free, kills_team "
            "FROM users WHERE username = $1",
            username,
        )


async def create_user(username: str, password_hash: str) -> None:
    async with _pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2)",
            username,
            password_hash,
        )


async def flush_stats(
    username: str,
    kill_delta: int,
    death_delta: int,
    exp_delta: int = 0,
    kills_free_delta: int = 0,
    kills_team_delta: int = 0,
) -> None:
    """Add (not set) to a user's lifetime totals. Called in small batches,
    not once per kill - see RoomManager.run_stat_flusher in game_state.py."""
    if not any((kill_delta, death_delta, exp_delta, kills_free_delta, kills_team_delta)):
        return
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE users
            SET kills = kills + $1,
                deaths = deaths + $2,
                exp = exp + $3,
                kills_free = kills_free + $4,
                kills_team = kills_team + $5
            WHERE username = $6
            """,
            kill_delta,
            death_delta,
            exp_delta,
            kills_free_delta,
            kills_team_delta,
            username,
        )


async def get_leaderboards(limit: int = 10) -> dict:
    """One round trip, five small indexed queries. At this table size
    (a hobby project's registered-user count) this is fast enough to run
    on every request with no caching layer needed."""
    async with _pool.acquire() as conn:
        level_rows = await conn.fetch(
            "SELECT username, exp FROM users ORDER BY exp DESC LIMIT $1", limit
        )
        overall_rows = await conn.fetch(
            "SELECT username, kills FROM users ORDER BY kills DESC LIMIT $1", limit
        )
        team_rows = await conn.fetch(
            "SELECT username, kills_team FROM users ORDER BY kills_team DESC LIMIT $1", limit
        )
        free_rows = await conn.fetch(
            "SELECT username, kills_free FROM users ORDER BY kills_free DESC LIMIT $1", limit
        )
        # Minimum-kills threshold so a 1-kill/0-death account can't sit
        # at the top of a ratio leaderboard on a tiny sample size.
        kd_rows = await conn.fetch(
            """
            SELECT username, kills, deaths,
                   kills::float / GREATEST(deaths, 1) AS kd
            FROM users
            WHERE kills >= 5
            ORDER BY kd DESC
            LIMIT $1
            """,
            limit,
        )
    return {
        "level_rows": [dict(r) for r in level_rows],
        "overall_rows": [dict(r) for r in overall_rows],
        "team_rows": [dict(r) for r in team_rows],
        "free_rows": [dict(r) for r in free_rows],
        "kd_rows": [dict(r) for r in kd_rows],
    }
