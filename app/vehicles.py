"""
Every "war machine" in the game, defined as data rather than art assets.
Nothing here references an image file — the client draws each vehicle
as vector shapes on a <canvas>, keyed off `cls` and `color`.

This dict is the single source of truth: the server simulates using it,
and the client fetches it once (GET /api/vehicles) so the two can never
drift out of sync.

Stats:
  speed       units/sec the vehicle can move
  hp          max health
  damage      damage dealt per projectile hit
  cooldown    seconds between shots
  proj_speed  units/sec a fired projectile travels
  radius      collision radius (also used for draw scale)
  color       base identity color shown on the select screen
              (in-match, players are colored by team or by player slot —
              see static/js/render.js)

Balance is intentionally rock-paper-scissors: fast+fragile machines have
the highest theoretical DPS, slow+heavy machines have the most HP and hit
hardest per shot but can be kited. None of this is final — tune freely,
every vehicle is just this one dict entry plus a draw function.
"""

VEHICLES = {
    "ranger": {
        "id": "ranger", "name": "Ranger", "cls": "tank",
        "speed": 180, "hp": 100, "damage": 18, "cooldown": 0.60,
        "proj_speed": 500, "radius": 22, "color": "#4fc3f7",
        "blurb": "Balanced tank. No real weakness, no real edge.",
    },
    "bulwark": {
        "id": "bulwark", "name": "Bulwark", "cls": "tank",
        "speed": 110, "hp": 160, "damage": 28, "cooldown": 1.00,
        "proj_speed": 450, "radius": 26, "color": "#7986cb",
        "blurb": "Heavy armor, heavy hits. Turns like a house.",
    },
    "falcon": {
        "id": "falcon", "name": "Falcon", "cls": "plane",
        "speed": 280, "hp": 60, "damage": 10, "cooldown": 0.25,
        "proj_speed": 650, "radius": 16, "color": "#ffb74d",
        "blurb": "Fastest thing in the sky. Dies if you look at it.",
    },
    "raptor": {
        "id": "raptor", "name": "Raptor", "cls": "plane",
        "speed": 230, "hp": 85, "damage": 15, "cooldown": 0.40,
        "proj_speed": 600, "radius": 18, "color": "#ff8a65",
        "blurb": "Agile all-rounder. Good first pick.",
    },
    "corsair": {
        "id": "corsair", "name": "Corsair", "cls": "ship",
        "speed": 150, "hp": 130, "damage": 20, "cooldown": 0.70,
        "proj_speed": 480, "radius": 24, "color": "#81c784",
        "blurb": "Steady hull, wide profile, dependable gun.",
    },
    "leviathan": {
        "id": "leviathan", "name": "Leviathan", "cls": "ship",
        "speed": 90, "hp": 200, "damage": 35, "cooldown": 1.30,
        "proj_speed": 420, "radius": 30, "color": "#4db6ac",
        "blurb": "Slow, massive, and hits like a demolition.",
    },
}
