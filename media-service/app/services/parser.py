"""短视频无水印解析：多重容错管道。

策略顺序（每一步失败自动降级到下一步）：
  1. 分享文本中提取 URL → 域名识别平台
  2. 跟随短链跳转（移动端 UA 伪装）拿到落地页
  3. 平台专属提取：页面内嵌 JSON 正则 → 官方开放 API
  4. 抖音 / TikTok 签名接口失败时降级到可配置的备用解析服务
  5. 媒体直链改写为短期签名代理，浏览器无需处理 CDN Referer 校验
  6. 返回结构化错误（平台未知 / 网络受限 / 需要登录 / 视频已删除）

注意：各平台反爬策略经常变化，网络层（requests）在受限环境下可能不可用；
所有网络失败都收敛为 ParserError，调用方按 error_code 分支提示用户。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlencode, urlsplit

import requests

from app.core import config

log = logging.getLogger("livecraft.parser")

Platform = Literal["douyin", "kuaishou", "xiaohongshu", "tiktok"]

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36"
)

_MEDIA_HOST_SUFFIXES = (
    ".douyin.com",
    ".douyinvod.com",
    ".douyinpic.com",
    ".douyincdn.com",
    ".zjcdn.com",
    ".dycdn.com",
    ".bytedance.com",
    ".bytecdn.com",
    ".byteimg.com",
    ".ibyteimg.com",
    ".byteicdn.com",
    ".ibytedtos.com",
    ".pstatp.com",
    ".snssdk.com",
    ".amemv.com",
    ".byteoversea.com",
    ".tiktok.com",
    ".tiktokcdn.com",
    ".tiktokcdn-us.com",
    ".tiktokv.com",
    ".xhscdn.com",
    ".xhscdn.net",
    ".xhsimg.com",
    ".kuaishou.com",
    ".douyinstatic.com",
    ".kwimgs.com",
    ".kwaicdn.com",
    ".kscloud.com",
    ".yximgs.com",
    ".gifshow.com",
)

_dtk_lock = threading.Lock()
_dtk_cookie = ""
_dtk_cookie_expires_at = 0.0
_dtk_demo_credentials: tuple[str, str] | None = None

_DOMAIN_PATTERNS: dict[Platform, list[str]] = {
    "douyin": [r"douyin\.com", r"v\.douyin\.com", r"iesdouyin\.com"],
    "kuaishou": [r"kuaishou\.com", r"v\.kuaishou\.com", r"gifshow\.com"],
    "xiaohongshu": [r"xiaohongshu\.com", r"xhslink\.com"],
    "tiktok": [r"tiktok\.com", r"vt\.tiktok\.com", r"vm\.tiktok\.com"],
}

_URL_RE = re.compile(r"https?://[^\s\"'<>\\]+", re.IGNORECASE)


class ParserError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # unknown_platform | network | login_required | not_found | extract_failed


@dataclass
class ParseResult:
    platform: str
    video_url: str
    title: str = ""
    author: str = ""
    cover_url: str = ""
    download_url: str = ""
    strategy: str = ""
    warnings: list[str] = field(default_factory=list)
    # 图文作品（image_album）专用：无视频流，带图片组与背景音乐
    content_kind: str = "video"  # video | image_album
    images: list[str] = field(default_factory=list)
    music_url: str = ""
    music_title: str = ""


def extract_share_url(text: str) -> str:
    m = _URL_RE.search(text or "")
    if not m:
        raise ParserError("unknown_platform", "分享文本中没有找到链接")
    return m.group(0).rstrip(".,!?)]}")


def detect_platform(url: str) -> Platform:
    for platform, patterns in _DOMAIN_PATTERNS.items():
        if any(re.search(p, url, re.IGNORECASE) for p in patterns):
            return platform
    raise ParserError("unknown_platform", f"暂不支持该平台的链接：{url[:80]}")


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": MOBILE_UA, "Referer": "https://www.douyin.com/"})
    return s


def resolve_redirects(url: str, timeout: int = 15) -> tuple[str, str]:
    """跟随跳转，返回 (最终URL, 落地页HTML)。"""
    try:
        r = _session().get(url, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        return r.url, r.text
    except requests.RequestException as e:
        raise ParserError("network", f"抓取落地页失败（可能网络受限或被风控）：{e}") from e


def _json_from_page(html: str, *keys: str) -> dict | None:
    for script_re in (
        re.compile(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S),
        re.compile(r"window\.__INIT_PROPS__\s*=\s*(\{.*?\});", re.S),
        re.compile(r'"aweme_detail"\s*:\s*(\{.*?\})\s*,\s*"', re.S),
    ):
        for m in script_re.finditer(html):
            try:
                data = json.loads(m.group(1))
            except (json.JSONDecodeError, ValueError):
                continue
            for key in keys:
                found = _deep_find(data, key)
                if found:
                    return found
    return None


def _deep_find(obj, key: str, depth: int = 0):
    if depth > 8 or not isinstance(obj, (dict, list)):
        return None
    if isinstance(obj, dict):
        if key in obj and obj[key]:
            return obj[key]
        for v in obj.values():
            r = _deep_find(v, key, depth + 1)
            if r:
                return r
    else:
        for v in obj:
            r = _deep_find(v, key, depth + 1)
            if r:
                return r
    return None


def _first_playable(urls) -> str:
    if isinstance(urls, str):
        return urls
    if isinstance(urls, list):
        for u in urls:
            if isinstance(u, str) and u.startswith("http"):
                return u
            if isinstance(u, dict):
                for k in ("url_list", "urlList"):
                    v = _first_playable(u.get(k))
                    if v:
                        return v
    return ""


def _extract_douyin(final_url: str, html: str) -> ParseResult:
    # 策略 A：页面内嵌 JSON（aweme_detail）
    detail = _json_from_page(html, "aweme_detail")
    if detail:
        video = detail.get("video") or {}
        url = _first_playable(video.get("play_addr")) or _first_playable(video.get("download_addr"))
        url = url.replace("playwm", "play")  # 去水印：playwm → play
        if url:
            return ParseResult(
                platform="douyin", video_url=url,
                title=(detail.get("desc") or "")[:200],
                author=((detail.get("author") or {}).get("nickname") or ""),
                cover_url=_first_playable((video.get("cover") or {}).get("url_list")),
                strategy="page_json",
            )
    # 策略 B：从 URL 提取 aweme_id 调官方 feed 接口
    m = re.search(r"/video/(\d+)", final_url)
    if m:
        try:
            r = _session().get(
                "https://www.iesdouyin.com/aweme/v1/feed/",
                params={"aweme_id": m.group(1)}, timeout=15,
            )
            r.raise_for_status()
            aweme = (r.json().get("aweme_list") or [{}])[0]
            video = aweme.get("video") or {}
            url = (_first_playable(video.get("play_addr")) or "").replace("playwm", "play")
            if url:
                return ParseResult(
                    platform="douyin", video_url=url,
                    title=(aweme.get("desc") or "")[:200],
                    author=((aweme.get("author") or {}).get("nickname") or ""),
                    strategy="official_api",
                )
        except requests.RequestException as e:
            raise ParserError("network", f"抖音官方接口请求失败：{e}") from e
    raise ParserError("extract_failed", "未能从抖音页面提取到无水印视频地址（页面结构可能已变化）")


def _extract_kuaishou(final_url: str, html: str) -> ParseResult:
    m = re.search(r"/s/([A-Za-z0-9_-]+)|photoId=([A-Za-z0-9_-]+)|/([A-Za-z0-9_-]{10,})$", final_url)
    # 策略 A：页面内嵌 JSON 找 photo / videoUrl
    for key in ("photo", "videoUrl", "video_url"):
        found = _deep_find(_json_from_page(html) or {}, key) if key == "photo" else None
        if found and isinstance(found, dict):
            url = found.get("videoUrl") or found.get("mainMvUrls", [{}])[0].get("url") if isinstance(found.get("mainMvUrls"), list) else ""
            if url:
                return ParseResult(platform="kuaishou", video_url=url, strategy="page_json")
    # 策略 B：正则直接扫页面里的 mp4
    for pat in (r'"videoUrl"\s*:\s*"([^"]+\.mp4[^"]*)"', r"(https?://[^\"'\s]+\.mp4[^\"'\s]*)"):
        mm = re.search(pat, html)
        if mm:
            return ParseResult(platform="kuaishou", video_url=mm.group(1).replace("\\u0026", "&"), strategy="page_regex")
    raise ParserError("extract_failed", "未能从快手页面提取到视频地址（可能需要登录或页面结构已变化）")


def _extract_xiaohongshu(final_url: str, html: str) -> ParseResult:
    m = re.search(r"/(?:discovery/item|explore)/([a-f0-9]{24})", final_url)
    note_id = m.group(1) if m else ""
    # 策略 A：页面内嵌 __NEXT_DATA__ 找 videoInfo
    detail = _json_from_page(html, "noteDetailMap", "videoInfo")
    if detail:
        info = detail.get(note_id) or detail if isinstance(detail, dict) else None
        if isinstance(info, dict):
            video = info.get("video") or info.get("note", {}).get("video", {})
            media = video.get("media") or video.get("consumer", {})
            url = _first_playable(media.get("stream", {}).get("h264")) or _first_playable(media.get("originVideoKey"))
            if url:
                return ParseResult(
                    platform="xiaohongshu", video_url=url,
                    title=((info.get("note") or {}).get("title") or "")[:200],
                    strategy="page_json",
                )
    # 策略 B：正则扫页面 m3u8/mp4
    mm = re.search(r"(https?://[^\"'\s]+\.(?:mp4|m3u8)[^\"'\s]*)", html)
    if mm:
        return ParseResult(platform="xiaohongshu", video_url=mm.group(1), strategy="page_regex")
    raise ParserError("extract_failed", "未能从小红书页面提取到视频地址（大概率需要登录态）")


def _extract_tiktok(final_url: str, html: str) -> ParseResult:
    # 策略 A：oEmbed 拿标题作者
    title, author = "", ""
    try:
        r = _session().get("https://www.tiktok.com/oembed", params={"url": final_url}, timeout=15)
        if r.ok:
            data = r.json()
            title, author = data.get("title", ""), data.get("author_name", "")
    except requests.RequestException:
        pass
    # 策略 B：页面 JSON 找 playAddr
    detail = _json_from_page(html, "video")
    if detail:
        url = _first_playable((detail.get("playAddr") or ""))
        if url:
            return ParseResult(platform="tiktok", video_url=url, title=title[:200], author=author, strategy="page_json")
    mm = re.search(r'"playAddr"\s*:\s*"([^"]+)"', html)
    if mm:
        return ParseResult(platform="tiktok", video_url=mm.group(1).replace("\\u0026", "&"),
                           title=title[:200], author=author, strategy="page_regex")
    raise ParserError("extract_failed", "未能从 TikTok 页面提取到视频地址")


def _b64url_encode(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> str:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding).decode("utf-8")


def _proxy_signature(token: str, expires_at: int, download: str) -> str:
    message = f"{token}.{expires_at}.{download}".encode("utf-8")
    return hmac.new(
        config.PARSER_PROXY_SECRET.encode("utf-8"), message, hashlib.sha256
    ).hexdigest()


def make_media_proxy_path(
    video_url: str, *, download: bool = False, ttl_seconds: int | None = None
) -> str:
    """为上游媒体生成短期签名代理地址，避免浏览器直连 CDN 被 Referer 校验拦截。"""
    expires_at = int(time.time()) + (
        ttl_seconds or config.PARSER_PROXY_TTL_SECONDS
    )
    token = _b64url_encode(video_url)
    download_flag = "1" if download else "0"
    signature = _proxy_signature(token, expires_at, download_flag)
    query = urlencode(
        {
            "token": token,
            "exp": expires_at,
            "download": download_flag,
            "sig": signature,
        }
    )
    return f"/api/parser/media?{query}"


def validate_media_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False
    host = parsed.hostname.lower().rstrip(".")
    return any(
        host == suffix[1:] or host.endswith(suffix)
        for suffix in _MEDIA_HOST_SUFFIXES
    )


def verify_media_proxy(
    token: str, expires_at: str, download: str, signature: str
) -> str:
    try:
        expires = int(expires_at)
    except (TypeError, ValueError):
        return ""
    download_flag = "1" if str(download).lower() in ("1", "true") else "0"
    if expires < int(time.time()):
        return ""
    expected = _proxy_signature(token, expires, download_flag)
    if not hmac.compare_digest(signature, expected):
        return ""
    try:
        url = _b64url_decode(token)
    except (ValueError, UnicodeDecodeError):
        return ""
    return url if validate_media_url(url) else ""


def media_proxy_referer(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    if "tiktok" in host or "byteoversea" in host or "ibytedtos" in host:
        return "https://www.tiktok.com/"
    if any(
        name in host
        for name in (
            "douyin", "douyinvod", "zjcdn", "dycdn", "bytecdn", "byteimg",
            "pstatp", "snssdk", "amemv", "ibyteimg", "byteicdn",
        )
    ):
        return "https://www.douyin.com/"
    if "xhs" in host or "xiaohongshu" in host:
        return "https://www.xiaohongshu.com/"
    if "kuaishou" in host or "kwimgs" in host or "gifshow" in host:
        return "https://www.kuaishou.com/"
    return ""


def media_proxy_request_headers(url: str, range_header: str = "") -> dict[str, str]:
    headers = {
        "User-Agent": DESKTOP_UA,
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    referer = media_proxy_referer(url)
    if referer:
        headers["Referer"] = referer
    if range_header:
        headers["Range"] = range_header
    return headers


def _dtk_credentials() -> tuple[str, str] | None:
    global _dtk_demo_credentials
    if config.PARSER_FALLBACK_USERNAME and config.PARSER_FALLBACK_PASSWORD:
        return config.PARSER_FALLBACK_USERNAME, config.PARSER_FALLBACK_PASSWORD
    if not config.PARSER_FALLBACK_DEMO:
        return None
    if _dtk_demo_credentials:
        return _dtk_demo_credentials
    try:
        response = requests.get(
            f"{config.PARSER_FALLBACK_API_URL}/api/v1/auth/demo",
            timeout=20,
            headers={"Accept": "application/json", "User-Agent": DESKTOP_UA},
        )
        response.raise_for_status()
        data = response.json().get("data") or {}
        username = str(data.get("username") or "")
        password = str(data.get("password") or "")
        if username and password:
            _dtk_demo_credentials = (username, password)
            return _dtk_demo_credentials
    except (requests.RequestException, ValueError):
        return None
    return None


def _dtk_login(*, force: bool = False) -> str:
    global _dtk_cookie, _dtk_cookie_expires_at
    if not force and _dtk_cookie and time.time() < _dtk_cookie_expires_at:
        return _dtk_cookie

    with _dtk_lock:
        if not force and _dtk_cookie and time.time() < _dtk_cookie_expires_at:
            return _dtk_cookie
        credentials = _dtk_credentials()
        if not credentials:
            return ""
        try:
            response = requests.post(
                f"{config.PARSER_FALLBACK_API_URL}/api/v1/auth/login",
                json={"username": credentials[0], "password": credentials[1]},
                timeout=30,
                headers={"Accept": "application/json", "User-Agent": DESKTOP_UA},
            )
            response.raise_for_status()
            data = response.json().get("data") or {}
            cookie = response.cookies.get("dtk_session") or ""
            if not cookie:
                return ""
            try:
                expires_in = int(data.get("expires_in") or 604800)
            except (TypeError, ValueError):
                expires_in = 604800
            _dtk_cookie = cookie
            _dtk_cookie_expires_at = time.time() + max(60, expires_in - 60)
            return cookie
        except (requests.RequestException, ValueError):
            return ""


def _dtk_auth_headers(*, force: bool = False) -> dict[str, str] | None:
    headers = {"Accept": "application/json", "User-Agent": DESKTOP_UA}
    if config.PARSER_FALLBACK_API_KEY:
        headers["X-API-Key"] = config.PARSER_FALLBACK_API_KEY
        return headers
    cookie = _dtk_login(force=force)
    if not cookie:
        return None
    headers["Cookie"] = f"dtk_session={cookie}"
    return headers


def _dtk_parse_result(data: dict, platform: Platform) -> ParseResult | None:
    if not isinstance(data, dict):
        return None
    # 图文作品：没有视频流，返回图片组 + 背景音乐，避免误报为「风控失败」
    if data.get("kind") == "image_album":
        media = data.get("media") or {}
        images: list[str] = []
        for img in media.get("images") or []:
            if isinstance(img, dict) and isinstance(img.get("url"), str) and img["url"]:
                images.append(img["url"])
            elif isinstance(img, str) and img:
                images.append(img)
        if not images:
            return None
        music = data.get("music") or {}
        covers = media.get("covers") or []
        cover_url = images[0]
        if isinstance(covers, list) and covers and isinstance(covers[0], dict) and covers[0].get("url"):
            cover_url = str(covers[0]["url"])
        author = data.get("author") or {}
        return ParseResult(
            platform=str(data.get("platform") or platform),
            video_url="",
            title=str(data.get("title") or data.get("description") or "")[:200],
            author=str(author.get("nickname") or "") if isinstance(author, dict) else "",
            cover_url=cover_url,
            strategy="fallback_api",
            warnings=[
                "这是一条图文作品，没有视频；已提取全部图片，背景音乐可单独下载。",
                "平台官方接口风控升级，已通过第三方备用解析服务完成；分享链接会发送给该服务。",
            ],
            content_kind="image_album",
            images=images,
            music_url=str(music.get("play_url") or "") if isinstance(music, dict) else "",
            music_title=str(music.get("title") or "") if isinstance(music, dict) else "",
        )
    if data.get("kind") != "video":
        return None
    media = data.get("media") or {}
    candidates: list[dict] = []
    main_video = media.get("video")
    if isinstance(main_video, dict):
        candidates.append(main_video)
    streams = media.get("streams")
    if isinstance(streams, list):
        candidates.extend(v for v in streams if isinstance(v, dict))

    candidates = [v for v in candidates if isinstance(v.get("url"), str) and v["url"]]
    clean = [v for v in candidates if not v.get("watermark")]
    pool = clean or candidates
    if not pool:
        return None

    def quality(item: dict) -> tuple[int, int, int]:
        width = item.get("width") if isinstance(item.get("width"), int) else 0
        height = item.get("height") if isinstance(item.get("height"), int) else 0
        bitrate = item.get("bitrate") if isinstance(item.get("bitrate"), int) else 0
        return (width * height, bitrate, 1 if not item.get("watermark") else 0)

    video = max(pool, key=quality)
    covers = media.get("covers") or []
    cover_url = ""
    if isinstance(covers, list) and covers and isinstance(covers[0], dict):
        cover_url = str(covers[0].get("url") or "")
    author = data.get("author") or {}
    author_name = str(author.get("nickname") or "") if isinstance(author, dict) else ""
    title = str(data.get("title") or data.get("description") or "")[:200]
    warnings = [
        "平台官方接口风控升级，已通过第三方备用解析服务完成；分享链接会发送给该服务。"
    ]
    if not clean:
        warnings.append("该视频源未提供明确的无水印版本，请预览后确认。")
    return ParseResult(
        platform=str(data.get("platform") or platform),
        video_url=str(video["url"]),
        title=title,
        author=author_name,
        cover_url=cover_url,
        strategy="fallback_api",
        warnings=warnings,
    )


def _parse_with_fallback_api(url: str, platform: Platform) -> ParseResult | None:
    """备用解析服务（公共演示账号）存在间歇性超时/限流，失败后清会话重试一次。"""
    result = _parse_with_fallback_api_once(url, platform)
    if result:
        return result
    global _dtk_cookie, _dtk_cookie_expires_at
    _dtk_cookie = ""
    _dtk_cookie_expires_at = 0.0
    time.sleep(2.5)
    return _parse_with_fallback_api_once(url, platform)


def _parse_with_tikwm(url: str, platform: Platform) -> ParseResult | None:
    """第二备用源 tikwm（免登录）：对 TikTok 稳定，抖音视链接形态而定。"""
    if platform not in ("douyin", "tiktok"):
        return None
    try:
        r = requests.get(
            "https://www.tikwm.com/api/",
            params={"url": url, "hd": "1"},
            timeout=25,
            headers={"Accept": "application/json", "User-Agent": DESKTOP_UA},
        )
        r.raise_for_status()
        body = r.json()
    except (requests.RequestException, ValueError):
        return None
    if body.get("code") != 0:
        return None
    data = body.get("data") or {}
    video_url = str(data.get("play") or "")
    if not video_url:
        return None
    author = data.get("author") or {}
    return ParseResult(
        platform=platform,
        video_url=video_url,
        title=str(data.get("title") or "")[:200],
        author=str(author.get("nickname") or "") if isinstance(author, dict) else "",
        cover_url=str(data.get("cover") or ""),
        strategy="tikwm",
        warnings=["平台官方接口风控升级，已通过第二备用解析服务完成；分享链接会发送给该服务。"],
    )


def _parse_with_fallback_api_once(url: str, platform: Platform) -> ParseResult | None:
    base = config.PARSER_FALLBACK_API_URL
    if not base or platform not in ("douyin", "tiktok"):
        return None

    headers = _dtk_auth_headers()
    if not headers:
        return None

    response = None
    for attempt in range(2):
        try:
            response = requests.post(
                f"{base}/api/v1/parse",
                params={"wait": 30, "lang": "zh"},
                json={"url": url},
                headers=headers,
                timeout=50,
            )
        except requests.RequestException as exc:
            log.warning("fallback parser request failed: %s", exc)
            return None
        if response.status_code == 401 and attempt == 0 and not config.PARSER_FALLBACK_API_KEY:
            refreshed = _dtk_auth_headers(force=True)
            if refreshed:
                headers = refreshed
                continue
        break

    if response is None:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    if response.status_code not in (200, 202) or not body.get("success"):
        log.warning(
            "fallback parser rejected request: HTTP %s %s",
            response.status_code,
            body.get("error"),
        )
        return None

    data = body.get("data") or {}
    if response.status_code == 202 or data.get("state") in ("queued", "running"):
        task_id = str(data.get("task_id") or "")
        if not task_id:
            return None
        for _ in range(20):
            time.sleep(1.0)
            try:
                poll = requests.get(
                    f"{base}/api/v1/tasks/{task_id}",
                    params={"lang": "zh"},
                    headers=headers,
                    timeout=20,
                )
                poll.raise_for_status()
                task = poll.json().get("data") or {}
            except (requests.RequestException, ValueError):
                return None
            state = str(task.get("state") or "")
            if state == "done":
                data = task.get("data") or {}
                break
            if state in ("failed", "error", "cancelled"):
                return None
        else:
            return None

    return _dtk_parse_result(data, platform)


_EXTRACTORS = {
    "douyin": _extract_douyin,
    "kuaishou": _extract_kuaishou,
    "xiaohongshu": _extract_xiaohongshu,
    "tiktok": _extract_tiktok,
}


def _third_party_fallback(url: str) -> ParseResult | None:
    endpoint = config.THIRD_PARTY_RESOLVER_URL
    if not endpoint:
        return None
    try:
        r = requests.post(endpoint, json={"url": url}, timeout=20)
        r.raise_for_status()
        data = r.json()
        if data.get("video_url"):
            res = ParseResult(platform=data.get("platform", "unknown"), video_url=data["video_url"],
                              title=data.get("title", ""), author=data.get("author", ""),
                              cover_url=data.get("cover_url", ""), strategy="third_party")
            res.warnings.append("经由第三方解析引擎兜底，结果以其返回为准")
            return res
    except requests.RequestException:
        pass
    return None


def parse_share_link(share_text: str) -> ParseResult:
    url = extract_share_url(share_text)
    platform = detect_platform(url)
    final_url = url
    html = ""
    last_error: ParserError | None = None

    try:
        final_url, html = resolve_redirects(url)
    except ParserError as exc:
        last_error = exc

    if html:
        try:
            return _EXTRACTORS[platform](final_url, html)
        except ParserError as exc:
            last_error = exc

    # 抖音 / TikTok 的网页接口已启用签名校验，优先走独立解析服务。
    fallback = _parse_with_fallback_api(url, platform)
    if fallback:
        return fallback

    fallback = _parse_with_tikwm(final_url or url, platform)
    if fallback:
        return fallback

    fallback = _third_party_fallback(final_url or url)
    if fallback:
        return fallback

    if platform in ("douyin", "tiktok"):
        raise ParserError(
            "extract_failed",
            "平台风控或备用解析服务暂时不可用，请稍后重试，或换一条分享链接",
        )
    if last_error:
        raise last_error
    raise ParserError("extract_failed", "解析失败，请稍后重试或更换分享链接")
