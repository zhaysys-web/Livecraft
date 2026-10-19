"""POST /api/inpaint：图片去水印 / 局部擦除。

multipart 表单：
  image: 原图（必填）
  mask:  掩膜图，白=修复区（必填）
  method: telea | ns（默认 telea；仅 OpenCV 路径有效）
  radius: 修复半径像素（默认 3）

返回：PNG 图片流。响应头 X-Inpaint-Engine 标注实际引擎（opencv-telea / pil-fallback）。
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.services import inpaint as inpaint_svc

router = APIRouter(prefix="/api", tags=["inpaint"])

_MAX_BYTES = 50 * 1024 * 1024


async def _read_limited(f: UploadFile, name: str) -> bytes:
    data = await f.read()
    if not data:
        raise HTTPException(400, f"{name} 为空")
    if len(data) > _MAX_BYTES:
        raise HTTPException(413, f"{name} 超过 50MB 上限")
    return data


@router.post("/inpaint")
async def inpaint_image(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    method: str = Form("telea"),
    radius: str = Form("3"),
):
    if method not in ("telea", "ns"):
        raise HTTPException(400, "method 只能是 telea 或 ns")
    try:
        radius_i = max(1, min(20, int(radius)))
    except ValueError:
        raise HTTPException(400, "radius 必须是 1-20 的整数")

    image_bytes = await _read_limited(image, "image")
    mask_bytes = await _read_limited(mask, "mask")

    try:
        out = await asyncio.to_thread(
            inpaint_svc.inpaint, image_bytes, mask_bytes, method, radius_i  # type: ignore
        )
    except Exception as e:
        raise HTTPException(500, f"修复失败：{e}")

    engine = "opencv-telea" if inpaint_svc._CV2 else "pil-fallback"
    return Response(
        content=out,
        media_type="image/png",
        headers={"X-Inpaint-Engine": engine if method == "telea" else engine.replace("telea", method)},
    )
