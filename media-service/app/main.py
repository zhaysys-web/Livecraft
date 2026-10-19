"""LiveCraft media-service：FastAPI 媒体微服务。

路由：
  POST /api/live-photo   视频转实况照片（FFmpeg 管道 + 元数据配对）
  POST /api/parser       短视频分享链接无水印解析
  POST /api/inpaint      图片去水印 / 局部擦除
  GET  /api/health       健康检查
"""

from __future__ import annotations

import logging
import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core import config
from app.routers import inpaint as inpaint_router
from app.routers import livephoto as livephoto_router
from app.routers import parser as parser_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("livecraft.media")

app = FastAPI(title="LiveCraft media-service", version="0.3.0")

# 本应用无 Cookie 鉴权，关闭 allow_credentials，
# 以便 CORS_ORIGINS=* 在浏览器环境正常工作（公网部署时免去前后端域名配对）
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
    }


def main() -> None:
    import uvicorn

    log.info("DATA_DIR=%s PORT=%s", config.DATA_DIR, config.PORT)
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=False)


if __name__ == "__main__":
    main()
