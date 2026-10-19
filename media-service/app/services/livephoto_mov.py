"""Apple Live Photo metadata injection for QuickTime MOV files.

The video stream is never decoded or re-encoded here. We append a tiny timed
metadata sample to ``mdat``, add a metadata track to ``moov``, and patch the
existing chunk offsets so the original H.264/HEVC samples remain untouched.
"""

from __future__ import annotations

import math
import re
import struct
import uuid
from dataclasses import dataclass
from pathlib import Path

CONTENT_KEY = b"com.apple.quicktime.content.identifier"
STILL_TIME_KEY = b"com.apple.quicktime.still-image-time"
TIMED_SAMPLE = b"\x00\x00\x00\x09\x00\x00\x00\x01\xff"

_UUID_RE = re.compile(
    rb"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}"
)
_CONTAINER_TYPES = {
    b"moov",
    b"trak",
    b"mdia",
    b"minf",
    b"dinf",
    b"stbl",
    b"edts",
    b"tref",
    b"gmhd",
    b"udta",
    b"ilst",
}


@dataclass(frozen=True)
class LiveMovMetadata:
    asset_id: str
    still_time: float


@dataclass(frozen=True)
class _Atom:
    start: int
    size: int
    kind: bytes
    header_size: int = 8

    @property
    def end(self) -> int:
        return self.start + self.size

    @property
    def payload_start(self) -> int:
        return self.start + self.header_size

    def raw(self, data: bytes) -> bytes:
        return data[self.start : self.end]


def _canonical_identifier(asset_id: str) -> str:
    try:
        return str(uuid.UUID(asset_id)).upper()
    except (ValueError, AttributeError) as exc:
        raise ValueError("Apple 资产标识必须是标准 UUID") from exc


def _atom(kind: bytes, payload: bytes) -> bytes:
    if len(kind) != 4:
        raise ValueError("ISO-BMFF atom 类型必须是 4 字节")
    size = len(payload) + 8
    if size <= 0xFFFFFFFF:
        return struct.pack(">I4s", size, kind) + payload
    return struct.pack(">I4sQ", 1, kind, len(payload) + 16) + payload


def _parse_atoms(
    data: bytes, start: int = 0, end: int | None = None
) -> list[_Atom]:
    boundary = len(data) if end is None else end
    if start < 0 or boundary > len(data) or start > boundary:
        raise ValueError("ISO-BMFF 解析范围无效")
    result: list[_Atom] = []
    position = start
    while position < boundary:
        if position + 8 > boundary:
            raise ValueError("ISO-BMFF atom 头部不完整")
        size = int.from_bytes(data[position : position + 4], "big")
        kind = bytes(data[position + 4 : position + 8])
        header_size = 8
        if size == 1:
            if position + 16 > boundary:
                raise ValueError("ISO-BMFF 64 位 atom 头部不完整")
            size = int.from_bytes(data[position + 8 : position + 16], "big")
            header_size = 16
        elif size == 0:
            size = boundary - position
        if size < header_size or position + size > boundary:
            label = kind.decode("latin-1", errors="replace")
            raise ValueError(f"ISO-BMFF atom {label} 超出文件边界")
        result.append(_Atom(position, size, kind, header_size))
        position += size
    return result


def _children(data: bytes, parent: _Atom) -> list[_Atom]:
    return _parse_atoms(data, parent.payload_start, parent.end)


def _first_child(data: bytes, parent: _Atom, kind: bytes) -> _Atom | None:
    return next((item for item in _children(data, parent) if item.kind == kind), None)


def _patch_chunk_offsets(moov: bytes, delta: int) -> bytes:
    payload = bytearray(moov)
    top = _parse_atoms(payload)
    if len(top) != 1 or top[0].kind != b"moov":
        raise ValueError("需要一个完整的 moov atom")

    def visit(parent: _Atom) -> None:
        for item in _children(payload, parent):
            if item.kind in {b"stco", b"co64"}:
                count_at = item.payload_start + 4
                if count_at + 4 > item.end:
                    raise ValueError("MOV chunk offset 表不完整")
                count = int.from_bytes(payload[count_at : count_at + 4], "big")
                width = 4 if item.kind == b"stco" else 8
                entries = count_at + 4
                if entries + count * width > item.end:
                    raise ValueError("MOV chunk offset 条目超出 atom")
                for index in range(count):
                    position = entries + index * width
                    old = int.from_bytes(payload[position : position + width], "big")
                    new = old + delta
                    if new < 0 or new >= 1 << (width * 8):
                        raise ValueError("MOV chunk offset 调整后越界")
                    payload[position : position + width] = new.to_bytes(width, "big")
            elif item.kind in _CONTAINER_TYPES:
                visit(item)

    visit(top[0])
    return bytes(payload)


def _fullbox(version: int = 0, flags: int = 0) -> bytes:
    return bytes((version,)) + flags.to_bytes(3, "big")


def _content_identifier_meta(identifier: str) -> bytes:
    raw_id = identifier.encode("ascii")
    hdlr = _atom(
        b"hdlr",
        _fullbox() + b"\x00" * 4 + b"mdta" + b"\x00" * 12 + b"\x00\x00",
    )
    key_entry = struct.pack(">I4s", 8 + len(CONTENT_KEY), b"mdta") + CONTENT_KEY
    keys = _atom(b"keys", _fullbox() + struct.pack(">I", 1) + key_entry)
    data = _atom(b"data", struct.pack(">II", 1, 0) + raw_id)
    item = _atom(b"\x00\x00\x00\x01", data)
    return _atom(b"meta", hdlr + keys + _atom(b"ilst", item))


def _pascal(text: bytes) -> bytes:
    if len(text) > 255:
        raise ValueError("Pascal 字符串过长")
    return bytes((len(text),)) + text


def _timed_metadata_track(
    track_id: int,
    video_track_id: int,
    timescale: int,
    cover_ticks: int,
    sample_offset: int,
) -> bytes:
    track_duration = cover_ticks + 1
    matrix = struct.pack(
        ">9I",
        0x00010000,
        0,
        0,
        0,
        0x00010000,
        0,
        0,
        0,
        0x40000000,
    )
    tkhd = _atom(
        b"tkhd",
        _fullbox(flags=0x0F)
        + struct.pack(">IIIII", 0, 0, track_id, 0, track_duration)
        + b"\x00" * 8
        + struct.pack(">hhhh", 0, 0, 0, 0)
        + matrix
        + struct.pack(">II", 0, 0),
    )

    edits: list[bytes] = []
    if cover_ticks:
        edits.append(struct.pack(">IiHH", cover_ticks, -1, 1, 0))
    edits.append(struct.pack(">IiHH", 1, 0, 1, 0))
    elst = _atom(
        b"elst", _fullbox() + struct.pack(">I", len(edits)) + b"".join(edits)
    )
    edts = _atom(b"edts", elst)
    tref = _atom(b"tref", _atom(b"cdsc", struct.pack(">I", video_track_id)))

    mdhd = _atom(
        b"mdhd",
        _fullbox()
        + struct.pack(">IIII", 0, 0, timescale, 1)
        + struct.pack(">HH", 0x55C4, 0),
    )
    metadata_name = b"Core Media Metadata"
    hdlr = _atom(
        b"hdlr",
        _fullbox()
        + b"mhlrmetaappl"
        + struct.pack(">II", 1, 0)
        + _pascal(metadata_name),
    )

    gmin = _atom(
        b"gmin",
        _fullbox() + struct.pack(">H3HHH", 0x0040, 0x8000, 0x8000, 0x8000, 0, 0),
    )
    gmhd = _atom(b"gmhd", gmin)
    data_hdlr = _atom(
        b"hdlr",
        _fullbox()
        + b"dhlralisappl"
        + struct.pack(">II", 0, 0)
        + _pascal(b"Core Media Data Handler"),
    )
    alias = _atom(b"alis", _fullbox(flags=1))
    dref = _atom(b"dref", _fullbox() + struct.pack(">I", 1) + alias)
    dinf = _atom(b"dinf", dref)

    keyd = _atom(b"keyd", b"mdta" + STILL_TIME_KEY)
    dtyp = _atom(b"dtyp", _fullbox() + struct.pack(">I", 0x41))
    key_record = struct.pack(">II", 8 + len(keyd) + len(dtyp), 1) + keyd + dtyp
    keys = _atom(b"keys", key_record)
    mebx = _atom(b"mebx", b"\x00" * 6 + struct.pack(">H", 1) + keys)
    stsd = _atom(b"stsd", _fullbox() + struct.pack(">I", 1) + mebx)
    stts = _atom(b"stts", _fullbox() + struct.pack(">III", 1, 1, 1))
    stsc = _atom(b"stsc", _fullbox() + struct.pack(">IIII", 1, 1, 1, 1))
    stsz = _atom(
        b"stsz",
        _fullbox() + struct.pack(">II", 0, 1) + struct.pack(">I", len(TIMED_SAMPLE)),
    )
    if sample_offset <= 0xFFFFFFFF:
        chunk_offsets = _atom(
            b"stco", _fullbox() + struct.pack(">II", 1, sample_offset)
        )
    else:
        chunk_offsets = _atom(
            b"co64", _fullbox() + struct.pack(">IQ", 1, sample_offset)
        )
    stbl = _atom(b"stbl", stsd + stts + stsc + stsz + chunk_offsets)
    minf = _atom(b"minf", gmhd + data_hdlr + dinf + stbl)
    mdia = _atom(b"mdia", mdhd + hdlr + minf)
    return _atom(b"trak", tkhd + edts + tref + mdia)


def _movie_timescale(data: bytes, moov: _Atom) -> int:
    mvhd = _first_child(data, moov, b"mvhd")
    if mvhd is None:
        raise ValueError("MOV 缺少 mvhd")
    version = data[mvhd.payload_start]
    position = mvhd.start + (28 if version == 1 else 20)
    if position + 4 > mvhd.end:
        raise ValueError("MOV mvhd 不完整")
    timescale = int.from_bytes(data[position : position + 4], "big")
    if timescale <= 0:
        raise ValueError("MOV 时间基无效")
    return timescale


def _track_id(data: bytes, trak: _Atom) -> int:
    tkhd = _first_child(data, trak, b"tkhd")
    if tkhd is None:
        raise ValueError("MOV 轨道缺少 tkhd")
    version = data[tkhd.payload_start]
    position = tkhd.start + (28 if version == 1 else 20)
    return int.from_bytes(data[position : position + 4], "big")


def _track_handler(data: bytes, trak: _Atom) -> bytes | None:
    mdia = _first_child(data, trak, b"mdia")
    if mdia is None:
        return None
    hdlr = _first_child(data, mdia, b"hdlr")
    if hdlr is None or hdlr.start + 20 > hdlr.end:
        return None
    return data[hdlr.start + 16 : hdlr.start + 20]


def _required_boxes(data: bytes) -> tuple[list[_Atom], _Atom, _Atom, _Atom]:
    top = _parse_atoms(data)
    try:
        ftyp = next(item for item in top if item.kind == b"ftyp")
        mdat = next(item for item in top if item.kind == b"mdat")
        moov = next(item for item in top if item.kind == b"moov")
    except StopIteration as exc:
        raise ValueError("MOV 必须包含 ftyp、mdat 和 moov") from exc
    if len([item for item in top if item.kind == b"mdat"]) != 1:
        raise ValueError("MOV 包含多个 mdat，暂不支持写入实况元数据")
    if len([item for item in top if item.kind == b"moov"]) != 1:
        raise ValueError("MOV 包含多个 moov，暂无法写入实况元数据")
    return top, ftyp, mdat, moov


def inject_apple_metadata(
    mov_path: Path,
    content_identifier: str,
    still_time: float,
    duration: float,
) -> LiveMovMetadata:
    """Add content identifier and timed still-image-time without re-encoding."""
    identifier = _canonical_identifier(content_identifier)
    if not math.isfinite(still_time) or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Apple 封面时刻或视频时长无效")
    if still_time < 0 or still_time > duration:
        raise ValueError("Apple 封面时刻必须位于视频片段内")

    data = mov_path.read_bytes()
    top, _ftyp, mdat, moov = _required_boxes(data)
    timescale = _movie_timescale(data, moov)
    tracks = [item for item in _children(data, moov) if item.kind == b"trak"]
    ids = [_track_id(data, item) for item in tracks]
    video = next(
        (item for item in tracks if _track_handler(data, item) == b"vide"), None
    )
    if video is None:
        raise ValueError("MOV 中没有可关联的视频轨")
    video_track_id = _track_id(data, video)
    metadata_track_id = max(ids, default=0) + 1
    cover_ticks = round(still_time * timescale)
    max_tick = max(0, round(duration * timescale) - 1)
    cover_ticks = min(max(0, cover_ticks), max_tick)

    prefix = b"".join(
        item.raw(data) for item in top if item.kind not in {b"mdat", b"moov"}
    )
    old_media = data[mdat.payload_start : mdat.end]
    new_mdat = _atom(b"mdat", old_media + TIMED_SAMPLE)
    new_media_start = len(prefix) + (
        16 if int.from_bytes(new_mdat[:4], "big") == 1 else 8
    )
    delta = new_media_start - mdat.payload_start
    sample_offset = new_media_start + len(old_media)

    patched_moov = _patch_chunk_offsets(moov.raw(data), delta)
    parsed_moov = _parse_atoms(patched_moov)[0]
    original_children = patched_moov[parsed_moov.payload_start : parsed_moov.end]
    additions = _content_identifier_meta(identifier) + _timed_metadata_track(
        metadata_track_id,
        video_track_id,
        timescale,
        cover_ticks,
        sample_offset,
    )
    new_moov = _atom(b"moov", original_children + additions)

    temporary = mov_path.with_name(f".{mov_path.name}.livephoto.tmp")
    temporary.write_bytes(prefix + new_mdat + new_moov)
    temporary.replace(mov_path)
    return LiveMovMetadata(asset_id=identifier, still_time=cover_ticks / timescale)


def _first_chunk_offset(data: bytes, trak: _Atom) -> int:
    mdia = _first_child(data, trak, b"mdia")
    minf = _first_child(data, mdia, b"minf") if mdia else None
    stbl = _first_child(data, minf, b"stbl") if minf else None
    if stbl is None:
        raise ValueError("MOV 轨道缺少 sample table")
    table = _first_child(data, stbl, b"stco") or _first_child(data, stbl, b"co64")
    if table is None:
        raise ValueError("MOV 轨道缺少 chunk offset")
    count = int.from_bytes(data[table.payload_start + 4 : table.payload_start + 8], "big")
    if count < 1:
        raise ValueError("MOV chunk offset 为空")
    width = 4 if table.kind == b"stco" else 8
    start = table.payload_start + 8
    return int.from_bytes(data[start : start + width], "big")


def _cover_ticks(data: bytes, trak: _Atom) -> int:
    edts = _first_child(data, trak, b"edts")
    elst = _first_child(data, edts, b"elst") if edts else None
    if elst is None:
        return 0
    version = data[elst.payload_start]
    count = int.from_bytes(data[elst.payload_start + 4 : elst.payload_start + 8], "big")
    position = elst.payload_start + 8
    if count >= 2:
        if version == 0:
            value = int.from_bytes(data[position : position + 4], "big")
            media_time = int.from_bytes(
                data[position + 4 : position + 8], "big", signed=True
            )
        else:
            value = int.from_bytes(data[position : position + 8], "big")
            media_time = int.from_bytes(
                data[position + 8 : position + 16], "big", signed=True
            )
        if media_time == -1:
            return value
    return 0


def read_apple_metadata(mov_path: Path) -> LiveMovMetadata:
    data = mov_path.read_bytes()
    _top, _ftyp, _mdat, moov = _required_boxes(data)
    timescale = _movie_timescale(data, moov)
    moov_bytes = moov.raw(data)
    if CONTENT_KEY not in moov_bytes:
        raise ValueError("MOV 缺少 Apple content identifier 键")
    matches = _UUID_RE.findall(moov_bytes)
    if not matches:
        raise ValueError("MOV 缺少 Apple 资产 UUID")
    identifier = _canonical_identifier(matches[-1].decode("ascii"))
    tracks = [item for item in _children(data, moov) if item.kind == b"trak"]
    metadata = next(
        (
            item
            for item in tracks
            if _track_handler(data, item) == b"meta"
            and STILL_TIME_KEY in item.raw(data)
        ),
        None,
    )
    if metadata is None:
        raise ValueError("MOV 缺少 still-image-time 元数据轨")
    offset = _first_chunk_offset(data, metadata)
    if data[offset : offset + 8] != TIMED_SAMPLE[:8]:
        raise ValueError("MOV still-image-time sample 结构无效")
    return LiveMovMetadata(
        asset_id=identifier,
        still_time=_cover_ticks(data, metadata) / timescale,
    )
