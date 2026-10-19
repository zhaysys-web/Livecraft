"""FFmpeg planning for Apple Live Photo output.

The fast path stream-copies H.264/HEVC video into a MOV, so the video bitstream
is never re-encoded. A compatibility re-encode is used only when the source
codec/pixel format cannot be stored safely in QuickTime, or when ping-pong /
slowdown filling requires new frames.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.core import config

DurationMode = Literal[3, 5]
FallbackStrategy = Literal["pingpong", "slowdown", "keep"]
VideoCodec = Literal["h264", "hevc"]

_VCODEC = {"h264": "libx264", "hevc": "libx265"}

QUICKTIME_COPYABLE_VIDEO = {"h264", "hevc", "prores", "mjpeg"}
QUICKTIME_COPYABLE_AUDIO = {
    "aac",
    "alac",
    "mp3",
    "pcm_s16le",
    "pcm_s16be",
    "pcm_s24le",
    "pcm_s24be",
}

H264_COPYABLE_PIX_FMTS = {"yuv420p", "yuvj420p", "nv12"}
HEVC_COPYABLE_PIX_FMTS = H264_COPYABLE_PIX_FMTS | {"yuv420p10le", "p010le"}

@dataclass
class LivePhotoJobParams:
    duration_mode: DurationMode = 3
    clip_start: float = 0.0
    keyframe_time: float = 1.5
    fallback: FallbackStrategy = "pingpong"
    codec: VideoCodec = "h264"
    muted: bool = False
    audio_fade_secs: float = 0.2
    target_fps: int = 60
    content_identifier: str = ""
    video_duration: float = 0.0
    prefer_copy: bool = True

    source_fps: float = 30.0
    source_has_audio: bool = False
    source_video_codec: str = ""
    source_audio_codec: str = ""
    source_pix_fmt: str = ""


@dataclass
class FfmpegPlan:
    video_cmd: list[str] = field(default_factory=list)
    still_cmd: list[str] = field(default_factory=list)
    export_duration: float = 3.0
    needs_fallback: bool = False
    metadata_notes: list[str] = field(default_factory=list)
    video_action: str = "reencode"
    audio_action: str = "none"
    keyframe_offset: float = 0.0
    still_image_time: float = 0.0
    warnings: list[str] = field(default_factory=list)


def needs_fallback(video_duration: float, mode: DurationMode) -> bool:
    return 0 < video_duration < mode


def export_duration(p: LivePhotoJobParams) -> float:
    if p.fallback == "keep" and needs_fallback(p.video_duration, p.duration_mode):
        return p.video_duration
    return float(p.duration_mode)


def f2(n: float) -> str:
    return f"{n:.2f}"


def _fps(stream: dict) -> float:
    for key in ("avg_frame_rate", "r_frame_rate"):
        raw = stream.get(key) or ""
        num, _, den = raw.partition("/")
        try:
            value = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            continue
        if 0.1 <= value <= 240:
            return value
    return 30.0


def probe_video(path: Path) -> dict:
    """Return the source properties needed by both the copy and encode paths."""
    cmd = [
        config.FFPROBE_BIN,
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    out = subprocess.run(
        cmd, capture_output=True, text=True, timeout=60, check=True
    ).stdout
    info = json.loads(out)

    video = next(
        (
            s
            for s in info.get("streams", [])
            if s.get("codec_type") == "video"
            and (s.get("disposition") or {}).get("attached_pic") != 1
        ),
        None,
    )
    if video is None:
        raise ValueError("输入文件不包含视频流")

    audio = next(
        (s for s in info.get("streams", []) if s.get("codec_type") == "audio"),
        None,
    )
    duration = float(
        (info.get("format") or {}).get("duration")
        or video.get("duration")
        or 0
    )
    if not 0.2 <= duration <= 86400:
        raise ValueError("视频时长无效或过短（至少需要 0.2 秒）")

    return {
        "duration": duration,
        "fps": _fps(video),
        "has_audio": audio is not None,
        "video_codec": str(video.get("codec_name") or "unknown"),
        "audio_codec": str((audio or {}).get("codec_name") or ""),
        "pix_fmt": str(video.get("pix_fmt") or ""),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
    }


def _can_copy_video(p: LivePhotoJobParams) -> bool:
    codec = p.source_video_codec
    pix_fmt = p.source_pix_fmt
    if codec not in QUICKTIME_COPYABLE_VIDEO:
        return False
    if codec == "h264":
        return pix_fmt in H264_COPYABLE_PIX_FMTS
    if codec == "hevc":
        return pix_fmt in HEVC_COPYABLE_PIX_FMTS
    return True


def _build_mux_args() -> list[str]:
    # Apple keys and the timed still-image-time track are injected after FFmpeg
    # has produced the MOV. This avoids duplicate mdta boxes and keeps the
    # original video/audio packets byte-for-byte untouched on the fast path.
    return ["-map_metadata", "-1", "-movflags", "+faststart"]


def _build_copy_command(
    p: LivePhotoJobParams,
    src: Path,
    mov_out: Path,
    duration: float,
    keyframe_offset: float,
    audio_action: str,
) -> list[str]:
    cmd = [config.FFMPEG_BIN, "-y", "-v", "error"]
    if p.clip_start > 0:
        cmd += ["-ss", f"{p.clip_start:.6f}"]
    cmd += [
        "-i",
        str(src),
        "-t",
        f"{duration:.6f}",
        "-map",
        "0:v:0",
    ]
    if audio_action != "none":
        cmd += ["-map", "0:a:0"]

    cmd += ["-c:v", "copy"]
    if p.source_video_codec == "hevc":
        cmd += ["-tag:v", "hvc1"]
    if audio_action == "copy":
        cmd += ["-c:a", "copy"]
    elif audio_action == "reencode":
        cmd += ["-c:a", "aac", "-b:a", "192k"]
        fade = max(0.0, min(p.audio_fade_secs, duration / 4))
        if fade > 0:
            fade_out_at = max(0.0, duration - fade)
            cmd += [
                "-af",
                f"afade=t=in:st=0:d={fade:.3f},afade=t=out:st={fade_out_at:.3f}:d={fade:.3f}",
            ]
    else:
        cmd += ["-an"]

    cmd += ["-f", "mov"]
    cmd += _build_mux_args()
    cmd.append(str(mov_out))
    return cmd


def _build_encode_command(
    p: LivePhotoJobParams,
    src: Path,
    mov_out: Path,
    duration: float,
    keyframe_offset: float,
) -> list[str]:
    fps = max(1, int(round(min(60.0, p.source_fps or 30.0))))
    vcodec = _VCODEC[p.codec]
    fade = max(0.0, p.audio_fade_secs)
    fade_out_start = f2(max(0.0, duration - fade))
    short = needs_fallback(p.video_duration, p.duration_mode)
    force_reencode_short = short and p.fallback in ("pingpong", "slowdown")
    seg = p.video_duration if force_reencode_short else float(p.duration_mode)
    start = 0.0 if short else p.clip_start

    if not force_reencode_short:
        v_filter = (
            f"[0:v]trim=start={f2(start)}:duration={f2(duration)},"
            f"setpts=PTS-STARTPTS,fps={fps},settb=AVTB[v]"
        )
        a_filter = (
            f"[0:a]atrim=start={f2(start)}:duration={f2(duration)},"
            f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade:.3f},"
            f"afade=t=out:st={fade_out_start}:d={fade:.3f}[a]"
        )
    elif p.fallback == "pingpong":
        pair_frames = max(2, round(seg * fps) * 2)
        v_filter = (
            f"[0:v]trim=start=0:duration={f2(seg)},setpts=PTS-STARTPTS,fps={fps},"
            f"split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,"
            f"loop=loop=-1:size={pair_frames},trim=duration={f2(duration)},settb=AVTB[v]"
        )
        pair_samples = max(2, round(seg * 48000) * 2)
        a_filter = (
            f"[0:a]aresample=48000,atrim=start=0:duration={f2(seg)},"
            f"asetpts=PTS-STARTPTS,asplit[a1][a2];[a2]areverse[ar];"
            f"[a1][ar]concat=n=2:v=0:a=1,aloop=loop=-1:size={pair_samples},"
            f"atrim=duration={f2(duration)},afade=t=in:st=0:d={fade:.3f},"
            f"afade=t=out:st={fade_out_start}:d={fade:.3f}[a]"
        )
    else:  # slowdown
        stretch = duration / seg if seg > 0 else 1.0
        tempo = seg / duration if duration > 0 else 1.0
        tempos: list[str] = []
        while tempo < 0.5:
            tempos.append("atempo=0.5")
            tempo /= 0.5
        tempos.append(f"atempo={tempo:.4f}")
        v_filter = (
            f"[0:v]trim=start=0:duration={f2(seg)},setpts={stretch:.4f}*PTS,"
            f"fps={fps},settb=AVTB[v]"
        )
        a_filter = (
            f"[0:a]atrim=start=0:duration={f2(seg)},asetpts=PTS-STARTPTS,"
            + ",".join(tempos)
            + f",afade=t=in:st=0:d={fade:.3f},"
            f"afade=t=out:st={fade_out_start}:d={fade:.3f}[a]"
        )

    use_audio = p.source_has_audio and not p.muted
    filter_complex = v_filter if not use_audio else f"{v_filter};{a_filter}"

    cmd = [
        config.FFMPEG_BIN,
        "-y",
        "-v",
        "error",
        "-i",
        str(src),
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
    ]
    if use_audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    else:
        cmd += ["-an"]
    cmd += [
        "-c:v",
        vcodec,
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
    ]
    if p.codec == "hevc":
        cmd += ["-tag:v", "hvc1", "-x265-params", "log-level=error"]
    cmd += ["-f", "mov"]
    cmd += _build_mux_args()
    cmd.append(str(mov_out))
    return cmd


def build_plan(
    p: LivePhotoJobParams, src: Path, mov_out: Path, still_out: Path
) -> FfmpegPlan:
    duration = export_duration(p)
    if duration <= 0.1:
        raise ValueError("导出时长无效")

    short = needs_fallback(p.video_duration, p.duration_mode)
    short_needs_new_frames = short and p.fallback in ("pingpong", "slowdown")
    video_copyable = _can_copy_video(p)
    video_action = (
        "copy"
        if p.prefer_copy and not short_needs_new_frames and video_copyable
        else "reencode"
    )

    if p.muted or not p.source_has_audio:
        audio_action = "none"
    elif video_action == "copy" and p.source_audio_codec in QUICKTIME_COPYABLE_AUDIO:
        audio_action = "copy"
    elif video_action == "copy":
        audio_action = "reencode"
    elif p.source_audio_codec in QUICKTIME_COPYABLE_AUDIO:
        audio_action = "reencode"
    else:
        audio_action = "reencode"

    keyframe_offset = max(0.0, min(duration, p.keyframe_time - p.clip_start))
    still_image_time = round(keyframe_offset, 3)

    if video_action == "copy":
        video_cmd = _build_copy_command(
            p, src, mov_out, duration, keyframe_offset, audio_action
        )
    else:
        video_cmd = _build_encode_command(
            p, src, mov_out, duration, keyframe_offset
        )

    still_cmd = build_still_command(src, still_out, p.keyframe_time)

    warnings: list[str] = []
    if video_action == "copy":
        notes = [
            "视频：原画质流复制，未重新编码",
            f"音频：{'原样复制' if audio_action == 'copy' else ('转码为 AAC' if audio_action == 'reencode' else '无音轨 / 已静音')}",
        ]
    else:
        warnings.append(
            "源视频编码不兼容快速封装，或需要正倒放/慢放补帧；本次已转为兼容格式。"
        )
        notes = ["视频：已兼容转码（源文件不适合直接装入 QuickTime）"]
        if audio_action == "reencode":
            notes.append("音频：已转码为 AAC")
        elif audio_action == "none":
            notes.append("音频：无音轨 / 已静音")

    notes += [
        f"Content Identifier：{p.content_identifier}（JPG / MOV 严格匹配）",
        f"封面帧：片段内 {keyframe_offset:.2f}s（原视频 {p.keyframe_time:.2f}s）",
        "MOV 写入 content.identifier 与 still-image-time 元数据轨",
    ]

    return FfmpegPlan(
        video_cmd=video_cmd,
        still_cmd=still_cmd,
        export_duration=duration,
        needs_fallback=short,
        metadata_notes=notes,
        video_action=video_action,
        audio_action=audio_action,
        keyframe_offset=keyframe_offset,
        still_image_time=still_image_time,
        warnings=warnings,
    )


def build_still_command(src: Path, still_out: Path, at: float) -> list[str]:
    """Extract one full-quality JPEG at an absolute source timestamp."""
    return [
        config.FFMPEG_BIN,
        "-y",
        "-v",
        "error",
        "-ss",
        f"{at:.6f}",
        "-i",
        str(src),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=w='if(gte(iw,ih),min(3840,iw),-2)':h='if(gte(iw,ih),-2,min(3840,ih))'",
        "-q:v",
        "1",
        "-update",
        "1",
        str(still_out),
    ]
