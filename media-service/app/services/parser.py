"""短视频无水印解析：多重容错管道。

策略顺序（每一步失败自动降级到下一步）：
  1. 分享文本中提取 URL → 域名识别平台
  2. 跟随短链跳转（移动端 UA 伪装）拿到落地页
  3. 平台专属提取：页面内嵌 JSON 正则 → 官方开放 API → 第三方解析引擎（可选）
  4. 返回结构化错误（平台未知 / 网络受限 / 需要登录 / 视频已删除）

注意：各平台反爬策略经常变化，网络层（requests）在受限环境下可能不可用；
所有网络失败都收敛为 ParserError，调用方按 error_code 分支提示用户。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Literal

import requests

from app.core import config

Platform = Literal["douyin", "kuaishou", "xiaohongshu", "tiktok"]

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

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
    strategy: str = ""
    warnings: list[str] = field(default_factory=list)


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
    final_url, html = resolve_redirects(url)
    try:
        return _EXTRACTORS[platform](final_url, html)
    except ParserError:
        fb = _third_party_fallback(final_url)
        if fb:
            return fb
        raise
