"""
The live battlefield. Everything in this file is in-memory and
server-authoritative: clients send input, the server is the only thing
that ever decides where a vehicle actually ends up or whether a shot
landed. That's what keeps one player's browser from being able to lie
about its own position or health.

Two rooms exist for the whole lifetime of the process: "free" (Free Play)
and "team" (Two-Team War). Nothing here is specific to either mode except
team assignment, spawn points, and how a kill counts toward the
mode-specific leaderboard columns - the physics/combat loop is identical.

Each room rolls a random map (see maps.py) the moment it goes from empty
to having its first player, and keeps it until everyone leaves.
"""
import asyncio
import logging
import math
import random
import time
import uuid
from dataclasses import dataclass, field

from app import database
from app.config import STAT_FLUSH_INTERVAL, TICK_RATE
from app.leveling import EXP_PER_ACTIVE_INTERVAL, EXP_PER_KILL, level_for_exp
from app.maps import MAP_IDS, MAPS, WORLD_SIZE
from app.vehicles import VEHICLES

logger = logging.getLogger("frontline.game")

TICK_DT = 1.0 / TICK_RATE
RESPAWN_SECONDS = 3.0
SPAWN_PROTECTION_SECONDS = 1.5
PROJECTILE_LIFETIME = 2.2
EDGE_MARGIN = 20


def _blocked_by(x: float, y: float, radius: float, obstacles: list[dict]) -> bool:
    for o in obstacles:
        if o["type"] == "circle":
            if math.hypot(x - o["x"], y - o["y"]) < o["r"] + radius:
                return True
        else:  # axis-aligned rect, x/y is the center
            hw, hh = o["w"] / 2, o["h"] / 2
            closest_x = min(max(x, o["x"] - hw), o["x"] + hw)
            closest_y = min(max(y, o["y"] - hh), o["y"] + hh)
            if math.hypot(x - closest_x, y - closest_y) < radius:
                return True
    return False


@dataclass
class Player:
    id: str
    username: str
    vehicle_id: str
    websocket: object
    team: str | None = None
    x: float = 0.0
    y: float = 0.0
    angle: float = 0.0
    mx: float = 0.0
    my: float = 0.0
    firing: bool = False
    cooldown_left: float = 0.0
    hp: float = 0.0
    alive: bool = True
    respawn_at: float = 0.0
    protected_until: float = 0.0
    kills: int = 0
    deaths: int = 0
    # Lifetime EXP as of connection time, so (base_exp + session_exp_delta)
    # is always this player's true current total - used to detect a level
    # crossing live, without a DB round trip on every kill.
    base_exp: int = 0
    session_kill_delta: int = 0
    session_death_delta: int = 0
    session_exp_delta: int = 0
    session_kills_free_delta: int = 0
    session_kills_team_delta: int = 0

    def __post_init__(self):
        self.hp = VEHICLES[self.vehicle_id]["hp"]

    @property
    def stats(self):
        return VEHICLES[self.vehicle_id]

    @property
    def current_exp(self) -> int:
        return self.base_exp + self.session_exp_delta

    def to_public(self, now: float) -> dict:
        return {
            "id": self.id,
            "u": self.username,
            "v": self.vehicle_id,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "a": round(self.angle, 3),
            "hp": round(max(self.hp, 0), 1),
            "mhp": self.stats["hp"],
            "t": self.team,
            "al": self.alive,
            "k": self.kills,
            "d": self.deaths,
            "prot": now < self.protected_until,
        }


@dataclass
class Projectile:
    owner: str
    team: str | None
    x: float
    y: float
    angle: float
    speed: float
    damage: float
    born: float = field(default_factory=time.time)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])

    def to_public(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1), "a": round(self.angle, 3)}


class Room:
    def __init__(self, mode: str):
        self.mode = mode  # "free" | "team"
        self.players: dict[str, Player] = {}
        self.projectiles: list[Projectile] = []
        self.events: list[dict] = []
        self.map_id: str = random.choice(MAP_IDS)

    @property
    def map_def(self) -> dict:
        return MAPS[self.map_id]

    @property
    def obstacles(self) -> list[dict]:
        return self.map_def["obstacles"]

    def _blocked(self, x: float, y: float, radius: float) -> bool:
        return _blocked_by(x, y, radius, self.obstacles)

    # ---- membership -----------------------------------------------------

    def team_counts(self) -> tuple[int, int]:
        red = sum(1 for p in self.players.values() if p.team == "red")
        blue = sum(1 for p in self.players.values() if p.team == "blue")
        return red, blue

    def _assign_team(self) -> str | None:
        if self.mode != "team":
            return None
        red, blue = self.team_counts()
        if red < blue:
            return "red"
        if blue < red:
            return "blue"
        return random.choice(["red", "blue"])

    def pick_spawn(self, team: str | None) -> tuple[float, float]:
        m = self.map_def
        pool = m["free_spawns"]
        if team == "red":
            pool = m["red_spawns"]
        elif team == "blue":
            pool = m["blue_spawns"]
        return random.choice(pool)

    def add_player(self, username: str, vehicle_id: str, websocket, base_exp: int = 0) -> Player:
        if not self.players:
            # Empty room refilling - free to roll a new map, nobody's
            # mid-match to have the ground shift under them.
            self.map_id = random.choice(MAP_IDS)
            logger.info("room=%s rolled map=%s", self.mode, self.map_id)

        pid = uuid.uuid4().hex[:10]
        team = self._assign_team()
        player = Player(
            id=pid, username=username, vehicle_id=vehicle_id, websocket=websocket,
            team=team, base_exp=base_exp,
        )
        player.x, player.y = self.pick_spawn(team)
        player.protected_until = time.time() + SPAWN_PROTECTION_SECONDS
        self.players[pid] = player
        return player

    def remove_player(self, pid: str) -> None:
        self.players.pop(pid, None)

    def apply_input(self, pid: str, mx: float, my: float, aim: float, firing: bool) -> None:
        p = self.players.get(pid)
        if not p:
            return
        p.mx = max(-1.0, min(1.0, float(mx)))
        p.my = max(-1.0, min(1.0, float(my)))
        p.angle = float(aim)
        p.firing = bool(firing)

    # ---- simulation --------------------------------------------------

    def tick(self, dt: float) -> None:
        now = time.time()

        for p in self.players.values():
            if not p.alive and now >= p.respawn_at:
                p.alive = True
                p.hp = p.stats["hp"]
                p.x, p.y = self.pick_spawn(p.team)
                p.protected_until = now + SPAWN_PROTECTION_SECONDS

        for p in self.players.values():
            if not p.alive:
                continue
            self._move_player(p, dt)
            if p.cooldown_left > 0:
                p.cooldown_left = max(0.0, p.cooldown_left - dt)
            if p.firing and p.cooldown_left <= 0:
                p.cooldown_left = p.stats["cooldown"]
                self._fire(p)

        self._advance_projectiles(dt, now)

    def _move_player(self, p: Player, dt: float) -> None:
        norm = math.hypot(p.mx, p.my)
        if norm <= 0:
            return
        dx, dy = p.mx / norm, p.my / norm
        speed = p.stats["speed"]
        nx = min(max(p.x + dx * speed * dt, EDGE_MARGIN), WORLD_SIZE - EDGE_MARGIN)
        ny = min(max(p.y + dy * speed * dt, EDGE_MARGIN), WORLD_SIZE - EDGE_MARGIN)
        if not self._blocked(nx, ny, p.stats["radius"]):
            p.x, p.y = nx, ny
        elif not self._blocked(nx, p.y, p.stats["radius"]):
            p.x = nx
        elif not self._blocked(p.x, ny, p.stats["radius"]):
            p.y = ny

    def _fire(self, p: Player) -> None:
        stats = p.stats
        bx = p.x + math.cos(p.angle) * (stats["radius"] + 8)
        by = p.y + math.sin(p.angle) * (stats["radius"] + 8)
        self.projectiles.append(
            Projectile(owner=p.id, team=p.team, x=bx, y=by, angle=p.angle,
                       speed=stats["proj_speed"], damage=stats["damage"])
        )

    def _advance_projectiles(self, dt: float, now: float) -> None:
        survivors: list[Projectile] = []
        for proj in self.projectiles:
            proj.x += math.cos(proj.angle) * proj.speed * dt
            proj.y += math.sin(proj.angle) * proj.speed * dt

            # Lifetime alone bounds how long a projectile can exist. There's
            # deliberately no "still inside WORLD_SIZE" check here: a player
            # standing near an edge and firing outward can spawn a
            # projectile whose position is already past the boundary before
            # it's traveled anywhere, and a strict bounds check would cull
            # it in the same tick it was created - before it ever reached a
            # single broadcast, so the shot would just silently vanish for
            # the firing player. A few projectiles briefly existing just
            # past the map edge costs nothing at this scale.
            if now - proj.born > PROJECTILE_LIFETIME:
                continue
            if self._blocked(proj.x, proj.y, 4):
                continue
            if self._resolve_hit(proj, now):
                continue
            survivors.append(proj)
        self.projectiles = survivors

    def _resolve_hit(self, proj: Projectile, now: float) -> bool:
        """Returns True if the projectile hit something and should be removed."""
        for p in self.players.values():
            if not p.alive or p.id == proj.owner:
                continue
            if now < p.protected_until:
                continue
            if proj.team is not None and p.team == proj.team:
                continue
            if math.hypot(p.x - proj.x, p.y - proj.y) > p.stats["radius"]:
                continue

            p.hp -= proj.damage
            if p.hp <= 0:
                self._kill(p, proj)
            return True
        return False

    def _kill(self, victim: Player, proj: Projectile) -> None:
        now = time.time()
        victim.alive = False
        victim.hp = 0
        victim.deaths += 1
        victim.session_death_delta += 1
        victim.respawn_at = now + RESPAWN_SECONDS

        killer = self.players.get(proj.owner)
        if not killer:
            self.events.append({"type": "kill", "killer": None, "victim": victim.username})
            return

        killer.kills += 1
        killer.session_kill_delta += 1
        if self.mode == "team":
            killer.session_kills_team_delta += 1
        else:
            killer.session_kills_free_delta += 1

        old_level = level_for_exp(killer.current_exp)
        killer.session_exp_delta += EXP_PER_KILL
        new_level = level_for_exp(killer.current_exp)

        self.events.append({"type": "kill", "killer": killer.username, "victim": victim.username})
        if new_level > old_level:
            self.events.append({"type": "levelup", "username": killer.username, "level": new_level})

    # ---- networking --------------------------------------------------

    async def broadcast(self) -> None:
        if not self.players:
            return
        now = time.time()
        payload = {
            "type": "state",
            "players": [p.to_public(now) for p in self.players.values()],
            "projectiles": [pr.to_public() for pr in self.projectiles],
            "events": self.events,
        }
        self.events = []

        # Sent concurrently, not one-at-a-time: a single slow or stalled
        # client (bad connection, backgrounded tab) would otherwise stall
        # `await send_json(...)` for that one player and delay delivery -
        # and therefore the next tick - for everyone else in the room too.
        async def _send(pid: str, p: Player) -> str | None:
            try:
                await p.websocket.send_json(payload)
                return None
            except Exception:
                return pid

        results = await asyncio.gather(*(_send(pid, p) for pid, p in self.players.items()))
        for pid in results:
            if pid is not None:
                self.players.pop(pid, None)


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {"free": Room("free"), "team": Room("team")}

    def get_room(self, mode: str) -> Room:
        return self.rooms[mode]

    async def run_forever(self) -> None:
        while True:
            start = time.time()
            for room in self.rooms.values():
                if room.players:
                    room.tick(TICK_DT)
                    await room.broadcast()
            elapsed = time.time() - start
            await asyncio.sleep(max(0.0, TICK_DT - elapsed))

    async def run_stat_flusher(self) -> None:
        while True:
            await asyncio.sleep(STAT_FLUSH_INTERVAL)
            await self.award_passive_exp_and_flush()

    async def award_passive_exp_and_flush(self) -> None:
        for room in self.rooms.values():
            for p in room.players.values():
                old_level = level_for_exp(p.current_exp)
                p.session_exp_delta += EXP_PER_ACTIVE_INTERVAL
                new_level = level_for_exp(p.current_exp)
                if new_level > old_level:
                    room.events.append({"type": "levelup", "username": p.username, "level": new_level})

            for p in list(room.players.values()):
                if any((
                    p.session_kill_delta, p.session_death_delta, p.session_exp_delta,
                    p.session_kills_free_delta, p.session_kills_team_delta,
                )):
                    try:
                        await database.flush_stats(
                            p.username, p.session_kill_delta, p.session_death_delta,
                            p.session_exp_delta, p.session_kills_free_delta, p.session_kills_team_delta,
                        )
                    except Exception:
                        logger.exception("failed to flush stats for %s - will retry next interval", p.username)
                        continue
                    p.base_exp += p.session_exp_delta
                    p.session_kill_delta = 0
                    p.session_death_delta = 0
                    p.session_exp_delta = 0
                    p.session_kills_free_delta = 0
                    p.session_kills_team_delta = 0
