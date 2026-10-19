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
# 单个视频时长上限（秒），ffprobe 探测后强制执行
MAX_VIDEO_DURATION_SECS = _env_int("MAX_VIDEO_DURATION_SECS", 600)
# 输出视频高度上限（像素）：源视频更高时降采样到该高度，减小文件体积、加快下载；
# 设为 0 则关闭。实况照片在相册内观看，1080p 已足够。
MAX_OUTPUT_HEIGHT = _env_int("MAX_OUTPUT_HEIGHT", 1080)

# ---- 公网安全加固 ----
# 通用 API 限流（次/分钟/IP）
RATE_LIMIT_PER_MINUTE = _env_int("RATE_LIMIT_PER_MINUTE", 120)
# 转码接口更严格：FFmpeg 是 CPU 密集型
RATE_LIMIT_CONVERT_PER_MINUTE = _env_int("RATE_LIMIT_CONVERT_PER_MINUTE", 8)
RATE_LIMIT_PARSER_PER_MINUTE = _env_int("RATE_LIMIT_PARSER_PER_MINUTE", 30)
RATE_LIMIT_INPAINT_PER_MINUTE = _env_int("RATE_LIMIT_INPAINT_PER_MINUTE", 20)
# 同时进行的转码任务数（Render 免费版 CPU 弱，默认 2）
MAX_CONCURRENT_JOBS = _env_int("MAX_CONCURRENT_JOBS", 2)
SECURITY_HEADERS_ENABLED = _env("SECURITY_HEADERS_ENABLED", "1").lower() in (
    "1",
    "true",
    "yes",
    "on",
)

FFMPEG_BIN = _env("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = _env("FFPROBE_BIN", "ffprobe")

def _parse_cors_origins() -> list[str]:
    raw = _env("CORS_ORIGINS", "").strip()
    if raw == "":
        # 未配置时使用白名单（生产前端 + 本地开发）
        return [
            "https://livecraft-ten.vercel.app",
            "http://localhost:3000",
            "http://localhost:3102",
        ]
    # 显式配置（含 "*"）按用户意图执行；要收紧请把 Render 的 CORS_ORIGINS
    # 改为前端域名（逗号分隔），不要用 "*"
    return [o.strip() for o in raw.split(",") if o.strip()]


CORS_ORIGINS = _parse_cors_origins()

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
