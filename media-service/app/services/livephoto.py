"""视频转实况照片管道：探测 → 参数规划 → FFmpeg 转码 → 元数据注入 → 校验。"""

from __future__ import annotations

import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.services import ffmpeg_plan
from app.services import metadata


@dataclass
class LivePhotoResult:
    still_path: Path
    mov_path: Path
    content_identifier: str
    export_duration: float
    still_image_time: int
    clip_start: float
    keyframe_time: float
    needs_fallback: bool
    fallback: str
    metadata_notes: list[str]


def run_livephoto_job(
    src: Path,
    out_dir: Path,
    params: ffmpeg_plan.LivePhotoJobParams,
) -> LivePhotoResult:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1) 探测源视频
    info = ffmpeg_plan.probe_video(src)
    params.video_duration = info["duration"]
    if not params.content_identifier:
        params.content_identifier = str(uuid.uuid4())
    # 封面帧钳制在导出区间内，避免越界
    export_dur = ffmpeg_plan.export_duration(params)
    short = ffmpeg_plan.needs_fallback(params.video_duration, params.duration_mode)
    if short:
        params.keyframe_time = min(max(params.keyframe_time, 0.0), info["duration"])
    else:
        lo = params.clip_start
        params.keyframe_time = min(max(params.keyframe_time, lo), lo + export_dur)
    params.clip_start = min(max(params.clip_start, 0.0), max(0.0, info["duration"] - export_dur if not short else 0.0))

    still_path = out_dir / "still.jpg"
    mov_path = out_dir / "live.mov"
    plan = ffmpeg_plan.build_plan(params, src, mov_path, still_path)

    # 2) 静态图提取
    subprocess.run(plan.still_cmd, capture_output=True, text=True, timeout=300, check=True)
    # 3) 视频转码
    subprocess.run(plan.video_cmd, capture_output=True, text=True, timeout=900, check=True)

    # 4) 元数据注入与校验
    metadata.inject_jpg_content_identifier(still_path, params.content_identifier)
    jpg_id = metadata.read_jpg_content_identifier(still_path)
    if jpg_id != params.content_identifier:
        raise RuntimeError(f"静态图 ContentIdentifier 回读不一致: {jpg_id!r}")
    mov_tags = metadata.read_mov_tags(mov_path)
    mov_id = mov_tags.get("com.apple.quicktime.content-identifier", "")
    if mov_id != params.content_identifier:
        raise RuntimeError(f".mov ContentIdentifier 回读不一致: {mov_id!r}")

    return LivePhotoResult(
        still_path=still_path,
        mov_path=mov_path,
        content_identifier=params.content_identifier,
        export_duration=plan.export_duration,
        still_image_time=round(params.keyframe_time),
        clip_start=params.clip_start,
        keyframe_time=params.keyframe_time,
        needs_fallback=plan.needs_fallback,
        fallback=params.fallback,
        metadata_notes=plan.metadata_notes,
    )
