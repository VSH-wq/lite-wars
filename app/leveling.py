"""
EXP/level progression. Pure functions, no I/O - trivial to unit test, and
impossible for "what the server awards" and "what gets shown" to drift
apart, since there's exactly one place this math happens.

Curve: reaching level L takes a cumulative EXP_BASE * (L-1)^2 lifetime EXP
(level 1 = 0, level 2 = 100, level 3 = 400, level 4 = 900, level 10 = 8100...).
Early levels come fast, later ones take meaningfully longer. Not tuned
against real playtest data - treat these constants as a starting point.

EXP is awarded in two places (see game_state.py): a flat amount per kill,
and a small trickle per player per stat-flush interval just for staying
connected, so progress doesn't come exclusively from getting kills.
"""

EXP_BASE = 100
EXP_PER_KILL = 30
EXP_PER_ACTIVE_INTERVAL = 3  # awarded once per STAT_FLUSH_INTERVAL while connected


def cumulative_exp_for_level(level: int) -> int:
    """Total lifetime EXP required to have REACHED this level. Level 1 needs 0."""
    if level <= 1:
        return 0
    return EXP_BASE * (level - 1) ** 2


def level_for_exp(exp: int) -> int:
    """The highest level this much cumulative EXP reaches."""
    exp = max(0, exp)
    level = 1
    while cumulative_exp_for_level(level + 1) <= exp:
        level += 1
    return level


def progress_in_level(exp: int) -> dict:
    """Where a player sits within their current level - level, and how far
    into it they are, for a progress bar. `progress` is 1.0 at the (rare)
    point where the curve's math can't produce a further level."""
    exp = max(0, exp)
    level = level_for_exp(exp)
    floor = cumulative_exp_for_level(level)
    ceiling = cumulative_exp_for_level(level + 1)
    span = ceiling - floor
    into = exp - floor
    return {
        "level": level,
        "exp": exp,
        "level_floor": floor,
        "level_ceiling": ceiling,
        "progress": (into / span) if span > 0 else 1.0,
    }
