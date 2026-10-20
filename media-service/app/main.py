"""LiveCraft media-service：FastAPI 媒体微服务。

路由：
  POST /api/live-photo   视频转实况照片（FFmpeg 管道 + 元数据配对）
  POST /api/parser       短视频分享链接无水印解析
  POST /api/inpaint      图片去水印 / 局部擦除
  GET  /api/health       健康检查
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config
from app.core.security import (
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    SlidingWindowRateLimiter,
)
from app.routers import inpaint as inpaint_router
from app.routers import livephoto as livephoto_router
from app.routers import parser as parser_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("livecraft.media")


def _sweep_data_dir() -> int:
    """删除 DATA_DIR 下超过 TTL 的任务目录（跳过点文件，如代理签名密钥）。"""
    removed = 0
    base = config.DATA_DIR
    if not base.exists():
        return 0
    now = time.time()
    try:
        entries = list(base.iterdir())
    except OSError:
        return 0
    for entry in entries:
        try:
            if (
                entry.name.startswith(".")
                or not entry.is_dir()
                or now - entry.stat().st_mtime <= config.JOB_TTL_SECONDS
            ):
                continue
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
        except OSError:
            continue
    return removed


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    stop = asyncio.Event()

    async def sweeper() -> None:
        while not stop.is_set():
            try:
                removed = await asyncio.to_thread(_sweep_data_dir)
                if removed:
                    log.info("TTL sweep: removed %d expired job dirs", removed)
            except Exception:
                log.exception("TTL sweep failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=600)
            except asyncio.TimeoutError:
                continue

    task = asyncio.create_task(sweeper())
    log.info(
        "media-service started: ttl=%ss max_concurrent=%d",
        config.JOB_TTL_SECONDS,
        config.MAX_CONCURRENT_JOBS,
    )
    yield
    stop.set()
    task.cancel()


app = FastAPI(
    title="LiveCraft media-service",
    version="0.4.1",
    lifespan=lifespan,
)

if config.SECURITY_HEADERS_ENABLED:
    app.add_middleware(SecurityHeadersMiddleware)

# 本应用无 Cookie 鉴权，关闭 allow_credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 限流：转码最严格，通用 API 次之
app.add_middleware(
    RateLimitMiddleware,
    limiter=SlidingWindowRateLimiter(),
    rules=[
        ("/api/live-photo", config.RATE_LIMIT_CONVERT_PER_MINUTE, 60),
        ("/api/inpaint", config.RATE_LIMIT_INPAINT_PER_MINUTE, 60),
        ("/api/parser", config.RATE_LIMIT_PARSER_PER_MINUTE, 60),
        ("/api/", config.RATE_LIMIT_PER_MINUTE, 60),
    ],
)

app.include_router(livephoto_router.router)
app.include_router(parser_router.router)
app.include_router(inpaint_router.router)


@app.get("/api/health")
def health():
    try:
        v = subprocess.run(
            [config.FFMPEG_BIN, "-version"], capture_output=True, text=True, timeout=10
        ).stdout.splitlines()[0]
    except Exception:
        v = "unavailable"
    try:
        import cv2  # type: ignore

        cv2_version = cv2.__version__
    except ImportError:
        cv2_version = None
    return {
        "ok": True,
        "service": "livecraft-media",
        "ffmpeg": v,
        "opencv": cv2_version,
        "cors_origins": config.CORS_ORIGINS,
        "version": "0.4.1",
        "limits": {
            "max_upload_mb": config.MAX_UPLOAD_MB,
            "max_video_duration_secs": config.MAX_VIDEO_DURATION_SECS,
            "max_concurrent_jobs": config.MAX_CONCURRENT_JOBS,
        },
    }


def main() -> None:
    import uvicorn

    log.info("DATA_DIR=%s PORT=%s", config.DATA_DIR, config.PORT)
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=False)


if __name__ == "__main__":
    main()
