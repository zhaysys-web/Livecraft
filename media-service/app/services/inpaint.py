"""图片去水印 / 局部擦除：后端高精度修复。

- 有 OpenCV 时：cv2.inpaint（TELEA / NS），半径可调——比前端 Canvas 的
  洋葱剥皮填充更适合大面积水印。
- 无 OpenCV 时：PIL 邻域均值填充兜底（保证服务不崩，结果质量较低）。

输入：原图 bytes + mask bytes（白=需要修复的区域）。
输出：PNG bytes。
"""

from __future__ import annotations

import io
import logging
from typing import Literal

from PIL import Image, ImageFilter

log = logging.getLogger(__name__)

try:
    import cv2  # type: ignore
    import numpy as np

    _CV2 = True
except ImportError:  # pragma: no cover
    _CV2 = False
    log.warning("opencv 未安装，inpaint 将降级为 PIL 邻域填充")


def _load_rgb(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _load_mask(data: bytes, size: tuple[int, int]) -> Image.Image:
    m = Image.open(io.BytesIO(data)).convert("L").resize(size, Image.BILINEAR)
    return m.point(lambda v: 255 if v > 40 else 0)


def inpaint(image_bytes: bytes, mask_bytes: bytes,
            method: Literal["telea", "ns"] = "telea", radius: int = 3) -> bytes:
    img = _load_rgb(image_bytes)
    mask = _load_mask(mask_bytes, img.size)

    if _CV2:
        arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        m = np.array(mask)
        flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
        out = cv2.inpaint(arr, m, radius, flag)
        out = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
    else:
        out = _pil_fill(img, mask)

    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def _pil_fill(img: Image.Image, mask: Image.Image) -> Image.Image:
    """PIL 兜底：对修复区做多轮邻域均值扩散填充。"""
    work = img.copy()
    px_mask = mask.load()
    w, h = img.size
    # 修复区先用周围模糊色打底
    blurred = img.filter(ImageFilter.GaussianBlur(radius=9))
    base = Image.composite(blurred, img, mask)
    # 3 轮 3x3 均值扩散，消除硬边
    for _ in range(3):
        px = base.load()
        nxt = base.copy()
        npx = nxt.load()
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if px_mask[x, y]:
                    r = g = b = 0
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            pr, pg, pb = px[x + dx, y + dy]
                            r += pr; g += pg; b += pb
                    npx[x, y] = (r // 9, g // 9, b // 9)
        base = nxt
    return base
