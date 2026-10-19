"""公网安全加固：安全响应头、IP 滑动窗口限流、转码并发信号量。"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """给每个响应加安全头。"""

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        return response


class SlidingWindowRateLimiter:
    """内存滑动窗口限流（单实例；多实例部署需换 Redis）。"""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str, limit: int, window_secs: int) -> bool:
        """滑动窗口计数；超限返回 False（不抛异常，调用方自行返回 429）。"""
        now = time.monotonic()
        async with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_secs:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


def _client_ip(request: Request) -> str:
    # Render 等平台经反向代理，取 X-Forwarded-For 首 IP
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """按路径前缀分组限流。

    rules: [(path_prefix, limit, window_secs)]，按顺序匹配第一条。
    """

    def __init__(self, app, limiter: SlidingWindowRateLimiter, rules):  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._limiter = limiter
        self._rules = rules

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        path = request.url.path
        for prefix, limit, window in self._rules:
            if path.startswith(prefix):
                allowed = await self._limiter.check(
                    f"{_client_ip(request)}:{prefix}", limit, window
                )
                if not allowed:
                    # 中间件在 ExceptionMiddleware 外层，抛 HTTPException 会变 500，
                    # 这里直接返回 429 JSON。
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "请求过于频繁，请稍后再试"},
                    )
                break
        return await call_next(request)
