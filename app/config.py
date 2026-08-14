"""
Central place for every setting that comes from the environment.

Locally, these are read from a `.env` file (see `.env.example`).
On Render, you set them as environment variables in the service dashboard.
"""
import os

from dotenv import load_dotenv

load_dotenv()

# Postgres connection string, e.g. from Neon:
# postgresql://user:password@host/dbname?sslmode=require
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Secret used to sign login tokens. MUST be overridden in production —
# the fallback below is only so the app can boot for local testing.
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-only-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))  # 7 days

# Simulation tick rate. 15/sec is smooth enough for top-down arcade combat
# while keeping CPU and network usage low on a free instance.
TICK_RATE = int(os.environ.get("TICK_RATE", "15"))

# How often (seconds) accumulated kill/death deltas are written to Postgres.
# Kept infrequent on purpose — see README for why.
STAT_FLUSH_INTERVAL = int(os.environ.get("STAT_FLUSH_INTERVAL", "60"))
