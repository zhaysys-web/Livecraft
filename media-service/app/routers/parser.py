"""POST /api/parser：短视频分享链接解析。

请求 JSON：{ "share_text": "复制的分享口令/链接文本" }
成功返回：{ platform, video_url, title, author, cover_url, strategy, warnings }
失败返回：HTTP 422 + { error_code, message }（error_code 见 services.parser.ParserError）
"""

from __future__ import annotations

import asyncio

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.core import config
from app.services import parser as parser_svc

router = APIRouter(prefix="/api", tags=["parser"])


class ParseRequest(BaseModel):
    share_text: str = Field(..., min_length=1, max_length=4000)


def _public_base(request: Request) -> str:
    if config.MEDIA_PUBLIC_BASE_URL:
        return config.MEDIA_PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


@router.post("/parser")
async def parse_link(req: ParseRequest, request: Request):
    try:
        result = await asyncio.to_thread(parser_svc.parse_share_link, req.share_text)
    except parser_svc.ParserError as e:
        return JSONResponse(
            status_code=422,
            content={"error_code": e.code, "message": str(e)},
        )
    base = _public_base(request)
    video_url = base + parser_svc.make_media_proxy_path(result.video_url)
    download_url = base + parser_svc.make_media_proxy_path(
        result.video_url, download=True
    )
    return {
        "platform": result.platform,
        "video_url": video_url,
        "download_url": download_url,
        "title": result.title,
        "author": result.author,
        "cover_url": result.cover_url,
        "strategy": result.strategy,
        "warnings": result.warnings,
    }


@router.get("/parser/media")
async def proxy_media(
    request: Request,
    token: str,
    exp: str,
    sig: str,
    download: str = "0",
):
    upstream_url = parser_svc.verify_media_proxy(token, exp, download, sig)
    if not upstream_url:
        raise HTTPException(403, "媒体链接无效或已过期，请重新解析")

    range_header = request.headers.get("range", "")
    headers = parser_svc.media_proxy_request_headers(upstream_url, range_header)
    try:
        upstream = await asyncio.to_thread(
            requests.get,
            upstream_url,
            headers=headers,
            stream=True,
            allow_redirects=True,
            timeout=(10, 90),
        )
    except requests.RequestException as exc:
        raise HTTPException(502, f"拉取视频失败：{exc}") from exc

    if upstream.status_code >= 400:
        upstream.close()
        raise HTTPException(502, f"视频源暂时不可用（HTTP {upstream.status_code}）")

    response_headers: dict[str, str] = {}
    for name in (
        "Content-Length",
        "Content-Range",
        "Accept-Ranges",
        "Last-Modified",
        "ETag",
    ):
        value = upstream.headers.get(name)
        if value:
            response_headers[name] = value
    response_headers["Cache-Control"] = "private, max-age=300"
    if download == "1":
        response_headers["Content-Disposition"] = (
            'attachment; filename="LiveCraft-video.mp4"'
        )

    def body():
        try:
            for chunk in upstream.iter_content(64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return StreamingResponse(
        body(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("Content-Type", "video/mp4"),
        headers=response_headers,
    )
