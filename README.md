# Frontline Arena

A 2D multiplayer top-down vehicle-combat browser game. Pick a war machine,
pick a front, and you're in — no lobby, no matchmaking queue.

Everything you see is drawn with `<canvas>` at runtime (vector shapes, not
image files), so there are no art assets to source, license, or host.

- **Free Play** — everyone is everyone's enemy, join and fight.
- **Team War** — Red vs Blue, runs forever, new players auto-join whichever
  side currently has fewer people.
- **Two maps** — Crossroads and Canyon Run. A room rolls one at random the
  moment its first player joins, and keeps it until everyone leaves, so a
  live match never has the terrain change under it.
- **Progression** — EXP and levels from playing and getting kills, with a
  level-up toast mid-match and a lifetime level/EXP badge in the lobby.
- **Leaderboard** — top 10 in five categories: level, kills overall, kills
  in Team War, kills in Free Play, and K/D ratio.

Six vehicles across three classes (tank / plane / ship), each with a
different feel and a more detailed, gradient-shaded silhouette. Stats live
in one place: `app/vehicles.py`.

## Stack

- **Backend**: Python 3.12, FastAPI, a single WebSocket for live gameplay
- **Frontend**: vanilla HTML/CSS/JS, no build step, no framework
- **Database**: Postgres (Neon's free tier) — accounts and lifetime
  progression only. Live match state never touches the database; it lives
  in memory in the running process.
- **Hosting**: Render's free web service tier

Total monthly cost at 10–20 concurrent players: **$0**, with the caveats
below.

---

## Upgrading an existing deployment

If you already deployed the earlier version of this project: just redeploy
this code over it. `init_schema()` runs additive, idempotent migrations on
every boot (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — your
existing Neon database and every account's kills/deaths carry over
untouched, and the new `exp`/`kills_free`/`kills_team` columns are simply
added at `0` for accounts that predate them. No manual migration step, and
this has been tested against a simulated pre-upgrade database, not just
assumed safe.

---

## Project layout

```
app/
  main.py         FastAPI app: static hosting, REST routes, the /ws/game endpoint
  config.py       reads environment variables
  database.py     Postgres access — accounts + progression, nothing else
  auth.py         registration, login, password hashing, JWT
  vehicles.py     the 6 vehicle definitions (stats + color) — single source of truth
  maps.py         the 2 map layouts (obstacles + spawn points)
  leveling.py     the EXP -> level curve, as pure functions
  ratelimit.py    a small in-memory rate limiter for the auth endpoints
  game_state.py   the actual simulation: rooms, physics tick, combat, respawns, progression
static/
  css/style.css
  js/api.js       fetch wrappers for every REST endpoint
  js/network.js   WebSocket client, sends input, auto-reconnects on drops
  js/render.js    all canvas drawing — battlefield, vehicles, obstacles, minimap, previews
  js/app.js       screens, input capture, leaderboard, the client-side game loop
index.html
requirements.txt
render.yaml       Render Blueprint — one-click free deploy
.env.example
```

---

## 1. Get a free Postgres database (Neon)

1. Go to [neon.tech](https://neon.tech) and sign up (no card required).
2. Create a project. Any region is fine.
3. Open **Connection Details** and copy the connection string. It looks like:
   `postgresql://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require`
4. Keep this — you'll paste it in as `DATABASE_URL` in step 3.

The app creates and migrates its own `users` table on every boot, so
there's no manual schema step whether this is a fresh database or an
upgrade of an existing one.

## 2. Run it locally (optional, but recommended before deploying)

```bash
python3.12 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: paste your Neon DATABASE_URL, and set JWT_SECRET to a random string
# (python -c "import secrets; print(secrets.token_hex(32))" will generate one)

uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000`, register an account, and play. Open a second
browser (or an incognito window) to test with two players at once.

## 3. Deploy to Render for free

**Push this project to a GitHub repo first** — Render deploys from a git
repo, so create a new repo and push this folder to it.

Then, in the Render dashboard:

1. **New → Blueprint**, and point it at your GitHub repo. Render reads
   `render.yaml` automatically and configures the service.
2. When prompted for `DATABASE_URL`, paste your Neon connection string
   from step 1. `JWT_SECRET` is generated for you automatically.
3. Deploy. First build takes a couple of minutes.
4. Your game is live at `https://<your-service-name>.onrender.com`.

If you'd rather not use a Blueprint: create a **New → Web Service** by hand,
set the build command to `pip install -r requirements.txt`, the start
command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, pick the
**Free** instance type, and add the same three environment variables
(`DATABASE_URL`, `JWT_SECRET`, and optionally `PYTHON_VERSION=3.12.0`) by hand.

### What "free" actually means here

- **Render's free web service** spins down after 15 minutes with no
  traffic, and takes 30–60 seconds to wake back up. This only affects
  the *first* player joining after a quiet spell — nobody already in a
  match gets kicked by this. The client auto-reconnects if the
  connection drops for any reason, including Render's periodic instance
  maintenance.
- **512 MB RAM / 0.1 CPU** on the free instance is comfortably enough for
  10–20 players — the simulation is simple 2D arithmetic, not physics-engine
  heavy. If you ever outgrow it, `TICK_RATE` in `.env` and the Render
  instance size are the two knobs to turn.
- **Neon's free tier** (0.5 GB storage, 100 compute-hours/month) is far
  more than this app needs — it only touches the database at login,
  register, leaderboard reads, and roughly once a minute per active player
  to save progression (see "Why stats are batched" below). It does not
  expire.
- **Bandwidth**: Render's free tier includes 100 GB/month. Usage scales
  with concurrent players and how long people play — normal hobby-project
  traffic at 10–20 players fits comfortably inside that.
- Deliberately **not used**: Render's own free Postgres (it expires 30
  days after creation — Neon doesn't), and Redis/any other paid add-on
  (in-memory state on the one instance is enough at this scale).

---

## How it works

**The server is the only authority.** Clients send input (movement
direction, aim angle, firing) roughly 15 times a second; the server is the
only thing that ever decides where a vehicle actually is or whether a shot
landed. A modified client can lie about its input, but it can't lie about
the outcome.

**Two rooms exist for the life of the process** — `free` and `team` — each
running its own physics tick at `TICK_RATE` (default 15/sec). An idle room
(no players) skips its tick entirely, so an empty game costs near-zero CPU.

**Maps roll on refill, not on a timer.** Each room picks a random map (see
`app/maps.py`) the moment it goes from 0 players to 1, and keeps that map
until it's empty again. Mid-match map swaps would mean repositioning
players who might suddenly be standing inside new terrain — rolling only on
an empty room sidesteps that entirely, at the cost of not rotating maps
during a single long, continuously-populated session.

**Progression is a visible stat, not a gameplay unlock.** EXP and levels
don't change any vehicle's stats or unlock anything — every vehicle is
available to everyone from the start. Leveling up is bragging rights and a
leaderboard category, so it can't quietly undermine the vehicle balance in
`app/vehicles.py`. EXP comes from two sources: a flat amount per kill, and
a small trickle per player every `STAT_FLUSH_INTERVAL` just for staying
connected (see `app/leveling.py` for the exact curve and constants).

**Why stats are batched, not written per kill:** every kill could trigger a
database write, but on a free Postgres tier that adds up fast if a match
runs for hours. Instead, kills/deaths/EXP accumulate in memory and flush to
Postgres once a minute per active player, plus immediately when someone
disconnects. Nobody loses more than a minute of progress even if the server
restarts. A failed flush (a momentary Neon hiccup) is logged and retried on
the next interval rather than silently dropped or crashing the loop.

**Client-side interpolation:** the server only broadcasts ~15 times/sec (to
keep bandwidth and CPU low), but the browser renders at 60fps. `app.js`
smooths between the last two snapshots it received so movement doesn't look
stepped, without needing the server to send updates any faster.

**Rate limiting is two separate limiters, not one.** A per-account limiter
on login (10 attempts / 15 min) is the actual brute-force protection — it
caps attempts against one specific account no matter where they come from.
A separate, more generous per-IP limiter (30 attempts / 5 min, shared by
register and login) is just a backstop against a single source spraying the
endpoints. They're kept apart deliberately: one shared per-IP bucket would
mean several unrelated people behind the same NAT/office/mobile-carrier IP
could 429 each other, which is a real scenario, not an edge case.

---

## API reference

| Endpoint | Method | Notes |
|---|---|---|
| `/` | GET | Serves the app |
| `/healthz` | GET | Liveness check, no DB dependency |
| `/api/vehicles` | GET | The 6 vehicle definitions |
| `/api/register` | POST | `{username, password}` |
| `/api/login` | POST | `{username, password}` → token + progression |
| `/api/me` | GET | `Authorization: Bearer <token>` → current progression |
| `/api/leaderboard` | GET | Top 10 in all 5 categories |
| `/ws/game` | WS | `?token=&mode=free\|team&vehicle=<id>` |

---

## Extending it

- **Add a vehicle**: add one entry to `VEHICLES` in `app/vehicles.py`
  (stats + a `cls` of `tank`/`plane`/`ship` + a color) — the select
  screen, stat bars, and battlefield rendering all pick it up
  automatically. No new art to make.
- **Add a new silhouette** (not just reuse tank/plane/ship): add a
  `drawX()` function alongside `drawTank`/`drawPlane`/`drawShip` in
  `static/js/render.js` and wire it into `drawVehicleShape`.
- **Retune balance**: every number in `app/vehicles.py` is live-tunable —
  redeploy and it takes effect immediately, no client update needed since
  the client fetches vehicle stats from the server.
- **Add a third map**: add an entry to `MAPS` in `app/maps.py` (obstacles +
  three spawn lists). It's picked up automatically everywhere maps are
  referenced — just make sure every spawn point clears every obstacle for
  the largest vehicle radius (there's an automated test for exactly this
  in the test suite, worth running again after adding one).
- **Retune the leveling curve**: everything is in `app/leveling.py` -
  `EXP_BASE`, `EXP_PER_KILL`, `EXP_PER_ACTIVE_INTERVAL`, or the curve shape
  in `cumulative_exp_for_level` itself.
- **Add a leaderboard category**: add a query to `get_leaderboards()` in
  `app/database.py`, a key in the `/api/leaderboard` response in
  `app/main.py`, and a tab in `LEADERBOARD_TABS` in `static/js/app.js`.
- **Add a third mode**: add a case to `Room._assign_team` (if it needs
  teams) or just add another `Room` to `RoomManager.rooms` in
  `app/game_state.py`, plus a mode card in `index.html`.

## Known limitations (by design, not oversight)

- No matchmaking, ranked play, or round timers — matches what was asked for.
- No touch controls — movement is WASD + mouse, so play is desktop-only
  for now. The lobby/menu/leaderboard screens are responsive; the
  battlefield itself needs a keyboard.
- No friendly fire in Team War.
- Reconnecting mid-match rejoins as a fresh spawn rather than resuming
  your exact in-match state (your lifetime account progression is
  unaffected).
- Maps roll per-room on refill, not on a fixed rotation — a room that
  never fully empties keeps its first map for as long as that streak lasts.
- EXP/level is purely a progression stat; it doesn't gate or boost
  anything gameplay-related. Say so if you'd actually like leveling to
  unlock vehicles or give stat bonuses — it's a different, more involved
  design than what's here.
