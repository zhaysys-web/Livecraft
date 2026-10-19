"""Apple Live Photo metadata helpers.

The JPG needs a real Apple MakerNote block with ContentIdentifier (tag 17).
Writing an arbitrary MakerNote is not enough, so this module vendors the tiny
69-byte donor block used by proven Live Photo converters and only replaces its
36-character UUID. Piexif inserts the block without recompressing the JPEG.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import piexif

from app.core import config

CONTENT_IDENTIFIER_KEY = "com.apple.quicktime.content.identifier"
LEGACY_CONTENT_IDENTIFIER_KEY = "com.apple.quicktime.content-identifier"
STILL_IMAGE_TIME_KEY = "com.apple.quicktime.still-image-time"

# "Apple iOS\0" 签名 + 标准大端 TIFF：魔数必须是 0x002a(42)，
# 否则 iOS 的严格 TIFF 解析器会拒绝整个 MakerNote，导致 key 17 读不到、
# 相册无法把 JPG 和 MOV 配对成实况照片。
# 结构（TIFF 起始于 "MM"）：
#   MM 002a | ifd_offset=8 | count=1 | tag=17,type=ASCII(2),count=37,offset=26 | UUID\0
_APPLE_MAKERNOTE_PREFIX = (
    b"Apple iOS\x00"  # 10 字节签名
    b"MM\x00\x2a"  # TIFF 头：大端，魔数 42
    b"\x00\x00\x00\x08"  # 首个 IFD 偏移 = 8
    b"\x00\x01"  # 1 个目录项
    b"\x00\x11"  # tag 17 = ContentIdentifier
    b"\x00\x02"  # 类型 ASCII
    b"\x00\x00\x00\x25"  # 数量 37（36 位 UUID + \0）
    b"\x00\x00\x00\x16"  # 值偏移 = 22（自 TIFF 起始：2+2+4+2+12）
)
_UUID_RE = re.compile(
    rb"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    rb"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def inject_jpg_content_identifier(jpg_path: Path, content_identifier: str) -> None:
    """Write Apple MakerNotes:ContentIdentifier without changing pixel data."""
    raw = jpg_path.read_bytes()
    exif_dict = piexif.load(raw)
    exif_dict["Exif"][piexif.ExifIFD.MakerNote] = (
        _APPLE_MAKERNOTE_PREFIX + content_identifier.encode("ascii") + b"\x00"
    )
    exif_dict["0th"][piexif.ImageIFD.Make] = b"Apple"
    exif_dict["0th"][piexif.ImageIFD.Model] = b"iPhone"
    exif_dict["0th"][piexif.ImageIFD.Software] = b"LiveCraft"
    piexif.insert(piexif.dump(exif_dict), str(jpg_path))


def read_jpg_content_identifier(jpg_path: Path) -> str:
    exif_dict = piexif.load(jpg_path.read_bytes())
    maker = exif_dict["Exif"].get(piexif.ExifIFD.MakerNote, b"")
    if not isinstance(maker, bytes):
        return ""
    match = _UUID_RE.search(maker)
    return match.group(0).decode("ascii") if match else ""


def validate_live_photo_pair(still_path: Path, mov_path: Path) -> list[str]:
    """像 iOS 配对逻辑一样严格校验 JPG+MOV 文件对，返回问题列表（空=通过）。

    验收标准：
    1. JPG 是有效 JPEG 且 MakerNote 为标准 TIFF（含 tag 17 的 UUID）
    2. MOV 是有效 QuickTime 且含 content.identifier
    3. MOV 含 still-image-time 元数据轨道
    4. 两文件 ContentIdentifier 完全一致
    """
    import struct

    problems: list[str] = []

    # --- JPG ---
    try:
        raw = still_path.read_bytes()
    except OSError as e:
        return [f"JPG 不可读: {e}"]
    if not raw.startswith(b"\xff\xd8"):
        problems.append("JPG 不是有效的 JPEG（缺少 SOI）")
        return problems
    try:
        exif_dict = piexif.load(raw)
        maker = exif_dict["Exif"].get(piexif.ExifIFD.MakerNote, b"")
    except Exception as e:
        problems.append(f"JPG EXIF 解析失败: {e}")
        return problems
    if not isinstance(maker, bytes) or not maker.startswith(b"Apple iOS\x00"):
        problems.append("JPG 缺少 Apple MakerNote")
        return problems
    tiff = maker[10:]
    try:
        magic = struct.unpack(">H", tiff[2:4])[0]
        if magic != 42:
            problems.append(f"JPG MakerNote TIFF 魔数错误: {magic}（应为 42）")
            return problems
        ifd_off = struct.unpack(">I", tiff[4:8])[0]
        tag, typ, cnt, voff = struct.unpack(">HHII", tiff[ifd_off + 2:ifd_off + 14])
        if tag != 17 or typ != 2:
            problems.append(f"JPG MakerNote tag 结构错误: tag={tag} type={typ}")
            return problems
        jpg_cid = tiff[voff:voff + cnt].rstrip(b"\x00").decode("ascii")
        if not _UUID_RE.fullmatch(jpg_cid.encode("ascii")):
            problems.append(f"JPG ContentIdentifier 不是有效 UUID: {jpg_cid!r}")
            return problems
    except (struct.error, IndexError, UnicodeDecodeError) as e:
        problems.append(f"JPG MakerNote TIFF 解析失败: {e}")
        return problems

    # --- MOV ---
    try:
        tags = read_mov_tags(mov_path)
    except Exception as e:
        problems.append(f"MOV 元数据读取失败: {e}")
        return problems
    mov_cid = tags.get(CONTENT_IDENTIFIER_KEY, "")
    if not mov_cid:
        problems.append("MOV 缺少 com.apple.quicktime.content.identifier")
    elif mov_cid != jpg_cid:
        problems.append(f"ContentIdentifier 不一致: JPG={jpg_cid} MOV={mov_cid}")

    # --- still-image-time ---
    try:
        from app.services import livephoto_mov

        meta = livephoto_mov.read_apple_metadata(mov_path)
        if meta.still_time < 0:
            problems.append("MOV 缺少 still-image-time 元数据轨道")
    except Exception as e:
        problems.append(f"MOV still-image-time 读取失败: {e}")

    return problems


def read_mov_tags(mov_path: Path) -> dict:
    """Read QuickTime metadata keys (including the Apple content identifier)."""
    cmd = [
        config.FFPROBE_BIN,
        "-v",
        "error",
        "-show_entries",
        "format_tags",
        "-of",
        "json",
        str(mov_path),
    ]
    out = subprocess.run(
        cmd, capture_output=True, text=True, timeout=60, check=True
    ).stdout
    return json.loads(out).get("format", {}).get("tags", {})


def read_mov_content_identifier(tags: dict) -> str:
    return str(
        tags.get(CONTENT_IDENTIFIER_KEY)
        or tags.get(LEGACY_CONTENT_IDENTIFIER_KEY)
        or ""
    )


def read_mov_duration(mov_path: Path) -> float:
    cmd = [
        config.FFPROBE_BIN,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(mov_path),
    ]
    out = subprocess.run(
        cmd, capture_output=True, text=True, timeout=60, check=True
    ).stdout
    return float(json.loads(out).get("format", {}).get("duration") or 0)
