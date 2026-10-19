"""Video -> Apple Live Photo pipeline.

Flow: probe once -> normalize the requested window -> remux/encode -> extract
the selected key frame -> stamp matching Apple identifiers -> verify.
"""

from __future__ import annotations

import logging
import math
import subprocess
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.services import ffmpeg_plan, livephoto_mov, metadata
from app.core import config

log = logging.getLogger("livecraft.livephoto")


@dataclass
class LivePhotoResult:
    still_path: Path
    mov_path: Path
    content_identifier: str
    export_duration: float
    output_duration: float
    still_image_time: float
    keyframe_offset: float
    clip_start: float
    keyframe_time: float
    needs_fallback: bool
    fallback: str
    video_action: str
    audio_action: str
    source_video_codec: str
    source_pix_fmt: str
    metadata_notes: list[str]
    warnings: list[str]
    file_base_name: str


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))


def _new_file_base_name() -> str:
    stamp = datetime.now().strftime("IMG_%Y%m%d_%H%M%S")
    return f"{stamp}_{uuid.uuid4().hex[:4].upper()}"


def _prepare_params(
    params: ffmpeg_plan.LivePhotoJobParams, info: dict
) -> None:
    params.video_duration = float(info["duration"])
    params.source_fps = float(info["fps"])
    params.source_has_audio = bool(info["has_audio"])
    params.source_video_codec = str(info["video_codec"])
    params.source_audio_codec = str(info["audio_codec"])
    params.source_pix_fmt = str(info["pix_fmt"])
    params.source_width = float(info.get("width") or 0)
    params.source_height = float(info.get("height") or 0)
    params.content_identifier = (
        params.content_identifier.strip() or str(uuid.uuid4())
    ).upper()

    duration = ffmpeg_plan.export_duration(params)
    short = ffmpeg_plan.needs_fallback(params.video_duration, params.duration_mode)
    if short:
        params.clip_start = 0.0
    else:
        params.clip_start = _clamp(
            params.clip_start, 0.0, max(0.0, params.video_duration - duration)
        )

    if params.keyframe_time < 0:
        params.keyframe_time = params.clip_start + duration / 2
    if not math.isfinite(params.keyframe_time):
        raise ValueError("封面帧时间无效")

    latest = min(
        params.video_duration - 0.02,
        params.clip_start + duration - 0.02,
    )
    params.keyframe_time = _clamp(params.keyframe_time, params.clip_start, latest)


def run_livephoto_job(
    src: Path,
    out_dir: Path,
    params: ffmpeg_plan.LivePhotoJobParams,
) -> LivePhotoResult:
    out_dir.mkdir(parents=True, exist_ok=True)
    job_start = time.monotonic()
    info = ffmpeg_plan.probe_video(src)
    _prepare_params(params, info)
    log.info(
        "job start: job=%s duration=%.1fs src=%s %dx%d fps=%.1f codec=%s mode=%ss",
        out_dir.name,
        params.video_duration,
        params.source_video_codec,
        int(params.source_width),
        int(params.source_height),
        params.source_fps,
        params.codec,
        params.duration_mode,
    )

    if params.video_duration > config.MAX_VIDEO_DURATION_SECS:
        raise ValueError(
            f"视频时长 {params.video_duration:.1f}s 超过 {config.MAX_VIDEO_DURATION_SECS}s 上限"
        )

    still_path = out_dir / "still.jpg"
    mov_path = out_dir / "live.mov"
    plan = ffmpeg_plan.build_plan(params, src, mov_path, still_path)
    log.info(
        "plan: job=%s video_action=%s audio_action=%s export=%.1fs",
        out_dir.name,
        plan.video_action,
        plan.audio_action,
        plan.export_duration,
    )

    t0 = time.monotonic()
    subprocess.run(
        plan.video_cmd, capture_output=True, text=True, timeout=900, check=True
    )
    log.info(
        "ffmpeg video done: job=%s elapsed=%.1fs",
        out_dir.name,
        time.monotonic() - t0,
    )

    output_duration = metadata.read_mov_duration(mov_path)
    if output_duration < 0.1:
        raise RuntimeError("输出的 MOV 时长无效")

    effective_still_time = min(
        max(0.0, plan.still_image_time), max(0.0, output_duration - 0.02)
    )
    still_cmd = plan.still_cmd
    if abs(effective_still_time - plan.still_image_time) > 0.001:
        still_cmd = ffmpeg_plan.build_still_command(
            src,
            still_path,
            params.clip_start + effective_still_time,
        )
    t0 = time.monotonic()
    subprocess.run(
        still_cmd, capture_output=True, text=True, timeout=300, check=True
    )
    log.info(
        "ffmpeg still done: job=%s elapsed=%.1fs",
        out_dir.name,
        time.monotonic() - t0,
    )

    if still_path.stat().st_size < 1000 or mov_path.stat().st_size < 1000:
        raise RuntimeError("生成的实况文件为空，请换一个视频重试")

    metadata.inject_jpg_content_identifier(
        still_path, params.content_identifier
    )
    jpg_id = metadata.read_jpg_content_identifier(still_path)
    if jpg_id != params.content_identifier:
        raise RuntimeError(f"JPG ContentIdentifier 回读不一致: {jpg_id!r}")

    live_mov = livephoto_mov.inject_apple_metadata(
        mov_path,
        params.content_identifier,
        effective_still_time,
        output_duration,
    )
    verified_mov = livephoto_mov.read_apple_metadata(mov_path)
    mov_id = verified_mov.asset_id
    if mov_id != params.content_identifier:
        raise RuntimeError(f"MOV ContentIdentifier 回读不一致: {mov_id!r}")
    if abs(verified_mov.still_time - live_mov.still_time) > 0.01:
        raise RuntimeError("MOV still-image-time 元数据回读不一致")

    log.info(
        "job done: job=%s total=%.1fs still=%dB mov=%dB",
        out_dir.name,
        time.monotonic() - job_start,
        still_path.stat().st_size,
        mov_path.stat().st_size,
    )

    return LivePhotoResult(
        still_path=still_path,
        mov_path=mov_path,
        content_identifier=params.content_identifier,
        export_duration=plan.export_duration,
        output_duration=output_duration,
        still_image_time=verified_mov.still_time,
        keyframe_offset=effective_still_time,
        clip_start=params.clip_start,
        keyframe_time=params.clip_start + effective_still_time,
        needs_fallback=plan.needs_fallback,
        fallback=params.fallback,
        video_action=plan.video_action,
        audio_action=plan.audio_action,
        source_video_codec=params.source_video_codec,
        source_pix_fmt=params.source_pix_fmt,
        metadata_notes=plan.metadata_notes,
        warnings=plan.warnings,
        file_base_name=_new_file_base_name(),
    )
