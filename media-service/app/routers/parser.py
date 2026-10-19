"""POST /api/parser：短视频分享链接解析。

请求 JSON：{ "share_text": "复制的分享口令/链接文本" }
成功返回：{ platform, video_url, title, author, cover_url, strategy, warnings }
失败返回：HTTP 422 + { error_code, message }（error_code 见 services.parser.ParserError）
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services import parser as parser_svc

router = APIRouter(prefix="/api", tags=["parser"])


class ParseRequest(BaseModel):
    share_text: str = Field(..., min_length=1, max_length=4000)


@router.post("/parser")
async def parse_link(req: ParseRequest):
    try:
        result = await asyncio.to_thread(parser_svc.parse_share_link, req.share_text)
    except parser_svc.ParserError as e:
        return JSONResponse(
            status_code=422,
            content={"error_code": e.code, "message": str(e)},
        )
    return {
        "platform": result.platform,
        "video_url": result.video_url,
        "title": result.title,
        "author": result.author,
        "cover_url": result.cover_url,
        "strategy": result.strategy,
        "warnings": result.warnings,
    }
