"""
Minimal in-memory sliding-window rate limiter, meant for the auth
endpoints. No Redis needed at this scale - state living in the one
running process is exactly where it needs to be for a single free-tier
instance, and it costs nothing when nobody's hammering the endpoint.

Not eviction-managed: a long-running server accumulates one small deque
per distinct IP that's ever hit a limited endpoint. At hobby-project
scale that's negligible; a public app under sustained traffic would
want a TTL sweep, which isn't worth the complexity here.
"""
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, max_attempts: int, window_seconds: float):
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> bool:
        """Records this call and returns whether it's allowed. Call once per
        attempt - a False result should also count against the window, so
        retries don't get a free pass."""
        now = time.time()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.max_attempts:
            return False
        hits.append(now)
        return True
