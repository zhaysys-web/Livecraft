"""FFmpeg 参数规划：前端 lib/livephoto.ts 中 buildFfmpegArgs 的 Python 移植。

约定与 TS 端完全一致：
- duration_mode: 3 | 5（秒）
- clip_start: 裁剪窗口起始（秒，相对原视频）
- keyframe_time: 封面帧时间戳（秒）→ 写入 still-image-time
- fallback: pingpong | slowdown | keep（仅当源视频短于目标时长时生效）
- codec: h264 | hevc；muted: 是否静音
- audio_fade_secs: 裁剪片段首尾淡入淡出（秒），防爆音
- content_identifier: UUID，静态图与视频元数据严格匹配
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


@dataclass
class FfmpegPlan:
    video_cmd: list[str] = field(default_factory=list)
    still_cmd: list[str] = field(default_factory=list)
    export_duration: float = 3.0
    needs_fallback: bool = False
    metadata_notes: list[str] = field(default_factory=list)


def needs_fallback(video_duration: float, mode: DurationMode) -> bool:
    return 0 < video_duration < mode


def export_duration(p: LivePhotoJobParams) -> float:
    if p.fallback == "keep" and needs_fallback(p.video_duration, p.duration_mode):
        return p.video_duration
    return float(p.duration_mode)


def f2(n: float) -> str:
    return f"{n:.2f}"


def probe_video(path: Path) -> dict:
    """ffprobe 读取视频时长 / 帧率 / 是否有音频流。"""
    cmd = [
        config.FFPROBE_BIN, "-v", "error",
        "-show_entries", "stream=codec_type,avg_frame_rate:format=duration",
        "-of", "json", str(path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True).stdout
    info = json.loads(out)
    duration = float(info.get("format", {}).get("duration") or 0)
    fps = 30.0
    has_audio = False
    vstreams = 0
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and vstreams == 0:
            vstreams += 1
            num, _, den = (s.get("avg_frame_rate") or "30/1").partition("/")
            try:
                fps = float(num) / float(den or 1)
            except (ValueError, ZeroDivisionError):
                fps = 30.0
        elif s.get("codec_type") == "audio":
            has_audio = True
    if vstreams == 0:
        raise ValueError("输入文件不包含视频流")
    return {"duration": duration, "fps": fps, "has_audio": has_audio}


def build_plan(p: LivePhotoJobParams, src: Path, mov_out: Path, still_out: Path) -> FfmpegPlan:
    T = export_duration(p)
    fps = min(p.target_fps, 60)
    vcodec = _VCODEC[p.codec]
    fade = p.audio_fade_secs
    fade_out_start = f2(max(0.0, T - fade))
    short = needs_fallback(p.video_duration, p.duration_mode)
    seg = p.video_duration if short else float(p.duration_mode)
    S = f2(0.0 if short else p.clip_start)

    if not short:
        v_filter = (
            f"[0:v]trim=start={S}:duration={f2(T)},setpts=PTS-STARTPTS,"
            f"fps={fps},settb=AVTB[v]"
        )
        a_filter = (
            f"[0:a]atrim=start={S}:duration={f2(T)},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade},"
            f"afade=t=out:st={fade_out_start}:d={fade}[a]"
        )
    elif p.fallback == "pingpong":
        D = f2(seg)
        pair_frames = max(2, round(seg * fps) * 2)
        v_filter = (
            f"[0:v]trim=start=0:duration={D},setpts=PTS-STARTPTS,fps={fps},"
            f"split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0,"
            f"loop=loop=-1:size={pair_frames},trim=duration={f2(T)},settb=AVTB[v]"
        )
        pair_samples = max(2, round(seg * 48000) * 2)
        a_filter = (
            f"[0:a]aresample=48000,atrim=start=0:duration={D},"
            f"asetpts=PTS-STARTPTS,asplit[a1][a2];[a2]areverse[ar];"
            f"[a1][ar]concat=n=2:v=0:a=1,aloop=loop=-1:size={pair_samples},"
            f"atrim=duration={f2(T)},"
            f"afade=t=in:st=0:d={fade},afade=t=out:st={fade_out_start}:d={fade}[a]"
        )
    elif p.fallback == "slowdown":
        D = f2(seg)
        stretch = T / seg if seg > 0 else 1.0
        tempo = seg / T if T > 0 else 1.0
        tempos: list[str] = []
        while tempo < 0.5:
            tempos.append("atempo=0.5")
            tempo /= 0.5
        tempos.append(f"atempo={tempo:.4f}")
        v_filter = (
            f"[0:v]trim=start=0:duration={D},setpts={stretch:.4f}*PTS,"
            f"fps={fps},settb=AVTB[v]"
        )
        a_filter = (
            f"[0:a]atrim=start=0:duration={D},asetpts=PTS-STARTPTS,"
            + ",".join(tempos) +
            f",afade=t=in:st=0:d={fade},afade=t=out:st={fade_out_start}:d={fade}[a]"
        )
    else:  # keep
        D = f2(T)
        v_filter = (
            f"[0:v]trim=start=0:duration={D},setpts=PTS-STARTPTS,"
            f"fps={fps},settb=AVTB[v]"
        )
        a_filter = (
            f"[0:a]atrim=start=0:duration={D},asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d={fade},"
            f"afade=t=out:st={fade_out_start}:d={fade}[a]"
        )

    use_audio = (not p.muted) and a_filter is not None
    filter_complex = v_filter if not use_audio else f"{v_filter};{a_filter}"

    video_cmd = [
        config.FFMPEG_BIN, "-y",
        "-i", str(src),
        "-filter_complex", filter_complex,
        "-map", "[v]",
    ]
    if use_audio:
        video_cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        video_cmd += ["-an"]
    video_cmd += [
        "-c:v", vcodec,
        "-pix_fmt", "yuv420p",
        "-movflags", "faststart+use_metadata_tags",
        "-metadata", f"com.apple.quicktime.content-identifier={p.content_identifier}",
        "-metadata", f"com.apple.quicktime.still-image-time={round(p.keyframe_time)}",
        str(mov_out),
    ]

    still_cmd = [
        config.FFMPEG_BIN, "-y",
        "-ss", f2(p.keyframe_time),
        "-i", str(src),
        "-frames:v", "1",
        "-q:v", "2",
        str(still_out),
    ]

    notes = [
        f"ContentIdentifier: {p.content_identifier}（.mov 与静态图严格匹配）",
        f"still-image-time: {round(p.keyframe_time)}s（封面帧 {f2(p.keyframe_time)}s 四舍五入）",
        "联调时以真机（iPhone 相册）验证元数据键名为准",
    ]
    return FfmpegPlan(
        video_cmd=video_cmd,
        still_cmd=still_cmd,
        export_duration=T,
        needs_fallback=short,
        metadata_notes=notes,
    )
