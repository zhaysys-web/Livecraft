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

# Apple iOS\0\0\1MM, one IFD entry for tag 17 (ASCII, 37 bytes, offset 32).
_APPLE_MAKERNOTE_PREFIX = bytes.fromhex(
    "4170706c6520694f530000014d4d000100110002000000250000002000000000"
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
