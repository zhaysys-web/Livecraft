"""LiveCraft media-service 配置：全部走环境变量，开箱即用。"""

from __future__ import annotations

import os
from pathlib import Path


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


DATA_DIR = Path(_env("DATA_DIR", "/tmp/livecraft-jobs"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

JOB_TTL_SECONDS = _env_int("JOB_TTL_SECONDS", 86400)
MAX_UPLOAD_MB = _env_int("MAX_UPLOAD_MB", 500)

FFMPEG_BIN = _env("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = _env("FFPROBE_BIN", "ffprobe")

CORS_ORIGINS = [
    o.strip()
    for o in _env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

THIRD_PARTY_RESOLVER_URL = _env("THIRD_PARTY_RESOLVER_URL", "")

HOST = _env("MEDIA_SERVICE_HOST", "0.0.0.0")
# Render 等平台注入 $PORT，优先采用；本地默认 8000
PORT = _env_int("MEDIA_SERVICE_PORT", _env_int("PORT", 8000))
