"""LiveCraft media-service 配置：全部走环境变量，开箱即用。"""

from __future__ import annotations

import os
import secrets
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
    for o in _env("CORS_ORIGINS", "*").split(",")
    if o.strip()
]

THIRD_PARTY_RESOLVER_URL = _env("THIRD_PARTY_RESOLVER_URL", "")

# 短视频解析兜底服务（dtk 兼容 API）。默认使用公开演示实例；
# 生产环境建议换成自建实例，并通过环境变量提供账号或 API Key。
PARSER_FALLBACK_API_URL = _env(
    "PARSER_FALLBACK_API_URL", "https://api.douyin.wtf"
).rstrip("/")
PARSER_FALLBACK_API_KEY = _env("PARSER_FALLBACK_API_KEY", "")
PARSER_FALLBACK_USERNAME = _env("PARSER_FALLBACK_USERNAME", "")
PARSER_FALLBACK_PASSWORD = _env("PARSER_FALLBACK_PASSWORD", "")
PARSER_FALLBACK_DEMO = _env("PARSER_FALLBACK_DEMO", "1").lower() in (
    "1", "true", "yes", "on",
)

# 媒体代理：CDN 会校验 Referer，浏览器不能直接播放/下载解析出的直链。
# 签名密钥优先读环境变量；否则持久化到 DATA_DIR，服务重启后旧链接仍可继续使用。
PARSER_PROXY_SECRET = _env("PARSER_PROXY_SECRET", "")
if not PARSER_PROXY_SECRET:
    _secret_file = DATA_DIR / ".parser-proxy-secret"
    try:
        PARSER_PROXY_SECRET = _secret_file.read_text(encoding="utf-8").strip()
    except OSError:
        PARSER_PROXY_SECRET = ""
    if len(PARSER_PROXY_SECRET) < 32:
        PARSER_PROXY_SECRET = secrets.token_urlsafe(32)
        try:
            _secret_file.write_text(PARSER_PROXY_SECRET, encoding="utf-8")
        except OSError:
            pass
PARSER_PROXY_TTL_SECONDS = _env_int("PARSER_PROXY_TTL_SECONDS", 7200)
MEDIA_PUBLIC_BASE_URL = _env("MEDIA_PUBLIC_BASE_URL", "").rstrip("/")

HOST = _env("MEDIA_SERVICE_HOST", "0.0.0.0")
# Render 等平台注入 $PORT，优先采用；本地默认 8000
PORT = _env_int("MEDIA_SERVICE_PORT", _env_int("PORT", 8000))
