"""
Map layouts. A Room rolls a random map (see game_state.py's Room.add_player)
the moment it goes from empty to having its first player, and keeps that
map for as long as anyone's in the room - a live match never has the
ground shift under it, and the playerbase isn't fragmented further by
letting people pick a map on top of picking a mode (at 10-20 concurrent
players split across just Free Play and Team War, adding per-map rooms
would leave most rooms nearly empty).

Obstacles come in two shapes, distinguished visually on the client as
well (rocks vs. bunkers):
  circle: {"type": "circle", "x", "y", "r"}
  rect:   {"type": "rect", "x", "y", "w", "h"}   (axis-aligned, x/y = center)

`theme` is just a hint the client uses to tint the terrain so the two maps
read as visually distinct at a glance, not only from their layout.
"""

WORLD_SIZE = 3000

MAPS = {
    "crossroads": {
        "name": "Crossroads",
        "theme": "ash",
        "obstacles": [
            {"type": "circle", "x": 600, "y": 600, "r": 90},
            {"type": "circle", "x": 2400, "y": 600, "r": 90},
            {"type": "circle", "x": 600, "y": 2400, "r": 90},
            {"type": "circle", "x": 2400, "y": 2400, "r": 90},
            {"type": "circle", "x": 1500, "y": 1500, "r": 140},
            {"type": "rect", "x": 1500, "y": 430, "w": 240, "h": 70},
            {"type": "rect", "x": 1500, "y": 2570, "w": 240, "h": 70},
            {"type": "rect", "x": 880, "y": 1500, "w": 70, "h": 240},
            {"type": "rect", "x": 2120, "y": 1500, "w": 70, "h": 240},
        ],
        "free_spawns": [
            (300, 300), (2700, 300), (300, 2700), (2700, 2700), (1500, 300),
            (1500, 2700), (300, 1500), (2700, 1500), (1000, 1000), (2000, 2000),
        ],
        "red_spawns": [(180, 300), (180, 1500), (180, 2700), (450, 1500)],
        "blue_spawns": [(2820, 300), (2820, 1500), (2820, 2700), (2550, 1500)],
    },
    "canyon": {
        "name": "Canyon Run",
        "theme": "rust",
        "obstacles": [
            {"type": "rect", "x": 1500, "y": 1000, "w": 900, "h": 60},
            {"type": "rect", "x": 1500, "y": 2000, "w": 900, "h": 60},
            {"type": "circle", "x": 800, "y": 1500, "r": 110},
            {"type": "circle", "x": 2200, "y": 1500, "r": 110},
            {"type": "circle", "x": 1500, "y": 1500, "r": 80},
            {"type": "circle", "x": 400, "y": 400, "r": 70},
            {"type": "circle", "x": 2600, "y": 400, "r": 70},
            {"type": "circle", "x": 400, "y": 2600, "r": 70},
            {"type": "circle", "x": 2600, "y": 2600, "r": 70},
        ],
        "free_spawns": [
            (250, 1500), (2750, 1500), (1500, 250), (1500, 2750),
            (700, 700), (2300, 700), (700, 2300), (2300, 2300),
            (1500, 1100), (1500, 1900),
        ],
        "red_spawns": [(200, 700), (200, 1500), (200, 2300), (500, 1500)],
        "blue_spawns": [(2800, 700), (2800, 1500), (2800, 2300), (2500, 1500)],
    },
}

MAP_IDS = list(MAPS.keys())
