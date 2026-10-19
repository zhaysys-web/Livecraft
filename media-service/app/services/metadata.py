"""实况配对元数据：静态图与视频的 ContentIdentifier 必须严格匹配。

- .mov：转码时由 FFmpeg 直接写入 com.apple.quicktime.* 元数据键。
- .jpg：本机无 ExifTool，改用 piexif 把 UUID 以 ASCII 写入 EXIF MakerNote
  （tag 0x927C 原始字节）。等价于参考命令：
      exiftool -overwrite_original -MakerNotes:ContentIdentifier=<uuid> still.jpg
  真机（iPhone 相册）验证通过后如需微调键名，只改本模块即可。
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import piexif

from app.core import config


def inject_jpg_content_identifier(jpg_path: Path, content_identifier: str) -> None:
    """把 ContentIdentifier UUID 写入 JPEG 的 EXIF MakerNote。"""
    raw = jpg_path.read_bytes()
    exif_dict = piexif.load(raw)
    exif_dict["Exif"][piexif.ExifIFD.MakerNote] = content_identifier.encode("ascii")
    exif_bytes = piexif.dump(exif_dict)
    piexif.insert(exif_bytes, str(jpg_path))


def read_jpg_content_identifier(jpg_path: Path) -> str:
    exif_dict = piexif.load(jpg_path.read_bytes())
    maker = exif_dict["Exif"].get(piexif.ExifIFD.MakerNote, b"")
    if isinstance(maker, bytes):
        return maker.decode("ascii", errors="ignore").strip("\x00")
    return ""


def read_mov_tags(mov_path: Path) -> dict:
    """ffprobe 读取 .mov 的 format_tags（验证 content-identifier）。"""
    cmd = [
        config.FFPROBE_BIN, "-v", "error",
        "-show_entries", "format_tags",
        "-of", "json", str(mov_path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True).stdout
    return json.loads(out).get("format", {}).get("tags", {})


def read_mov_duration(mov_path: Path) -> float:
    cmd = [
        config.FFPROBE_BIN, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", str(mov_path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True).stdout
    return float(json.loads(out).get("format", {}).get("duration") or 0)
