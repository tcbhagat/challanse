import time
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, Request, Response, status
from starlette.types import ASGIApp, Receive, Scope, Send


class _SlidingWindowCounter:
    """Per-key sliding-window rate counter using a deque of timestamps."""

    __slots__ = ("_max_requests", "_window_seconds", "_buckets")

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._buckets: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        window = self._buckets[key]
        # Remove timestamps outside the window
        cutoff = now - self._window_seconds
        while window and window[0] < cutoff:
            window.pop(0)
        if len(window) >= self._max_requests:
            return False
        window.append(now)
        return True


# Shared rate limiter: 10 pilot requests per hour per IP
_pilot_rate_limiter = _SlidingWindowCounter(max_requests=10, window_seconds=3600)


def check_pilot_rate_limit(request: Request) -> None:
    """Dependency: reject POST /v1/pilot-requests when the client IP exceeds the rate limit."""
    ip = request.client.host if request.client else "unknown"
    if not _pilot_rate_limiter.is_allowed(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="RATE_LIMITED",
            headers={"Retry-After": "3600"},
        )


class RateLimitMiddleware:
    """ASGI middleware that applies per-IP rate limiting to configured paths.

    Applied as an additional layer for paths that aren't easily covered by
    route-level dependencies (e.g. static file responses, login forms).
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        limits: dict[str, tuple[int, int]] | None = None,
    ) -> None:
        self.app = app
        # Default: 10 requests/hour for pilot endpoint
        self._limits = limits or {"/v1/pilot-requests": (10, 3600)}
        self._counters: dict[str, _SlidingWindowCounter] = {}

    def _counter_for(self, path: str) -> _SlidingWindowCounter | None:
        if path in self._limits:
            if path not in self._counters:
                max_req, window = self._limits[path]
                self._counters[path] = _SlidingWindowCounter(max_req, window)
            return self._counters[path]
        # Check prefix match
        for prefix, (max_req, window) in self._limits.items():
            if path.startswith(prefix):
                if prefix not in self._counters:
                    self._counters[prefix] = _SlidingWindowCounter(max_req, window)
                return self._counters[prefix]
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        path = request.url.path
        counter = self._counter_for(path)
        if counter is not None:
            ip = request.client.host if request.client else "unknown"
            if not counter.is_allowed(ip):
                response = Response(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content='{"detail":"RATE_LIMITED"}',
                    headers={"Retry-After": "3600", "Content-Type": "application/json"},
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
