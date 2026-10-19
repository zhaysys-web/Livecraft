"""POST /api/live-photo：视频转实况照片。

multipart 表单：
  video: 视频文件（必填）
  duration_mode: 3 | 5（默认 3）
  clip_start: 裁剪窗口起始秒（默认 0）
  keyframe_time: 封面帧时间戳秒（默认片段中点）
  fallback: pingpong | slowdown | keep（默认 pingpong）
  codec: h264 | hevc（默认 h264）
  muted: true | false（默认 false）
  audio_fade_secs: 音频淡入淡出秒（默认 0.2）
  content_identifier: 可选 UUID；不传则服务端生成

返回 JSON：{ job_id, still_url, mov_url, download_url, meta{...} }
文件通过 GET /api/jobs/{job_id}/{still.jpg|live.mov} 拉取，
GET /api/jobs/{job_id}/download 一次性拿 zip（still.jpg + live.mov）。
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import time
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core import config
from app.services import ffmpeg_plan, livephoto

router = APIRouter(prefix="/api", tags=["live-photo"])

_JOBS: dict[str, dict] = {}


def _job_dir(job_id: str) -> Path:
    d = config.DATA_DIR / "livephoto" / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sweep_expired() -> None:
    now = time.time()
    base = config.DATA_DIR / "livephoto"
    if not base.exists():
        return
    for d in base.iterdir():
        if d.is_dir() and now - d.stat().st_mtime > config.JOB_TTL_SECONDS:
            shutil.rmtree(d, ignore_errors=True)
            _JOBS.pop(d.name, None)


def _parse_bool(v: str) -> bool:
    return v.strip().lower() in ("1", "true", "yes", "on")


@router.post("/live-photo")
async def create_live_photo(
    video: UploadFile = File(...),
    duration_mode: str = Form("3"),
    clip_start: str = Form("0"),
    keyframe_time: str = Form(""),
    fallback: str = Form("pingpong"),
    codec: str = Form("h264"),
    muted: str = Form("false"),
    audio_fade_secs: str = Form("0.2"),
    content_identifier: str = Form(""),
):
    _sweep_expired()

    if duration_mode not in ("3", "5"):
        raise HTTPException(400, "duration_mode 只能是 3 或 5")
    if fallback not in ("pingpong", "slowdown", "keep"):
        raise HTTPException(400, "fallback 非法")
    if codec not in ("h264", "hevc"):
        raise HTTPException(400, "codec 非法")
    try:
        clip_start_f = max(0.0, float(clip_start))
        fade_f = max(0.0, float(audio_fade_secs))
    except ValueError:
        raise HTTPException(400, "clip_start / audio_fade_secs 必须是数字")

    job_id = uuid.uuid4().hex[:12]
    d = _job_dir(job_id)
    src = d / f"input_{Path(video.filename or 'video').suffix or '.mp4'}"

    size = 0
    with src.open("wb") as f:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > config.MAX_UPLOAD_MB * 1024 * 1024:
                f.close()
                shutil.rmtree(d, ignore_errors=True)
                raise HTTPException(413, f"文件超过 {config.MAX_UPLOAD_MB}MB 上限")
            f.write(chunk)

    mode: ffmpeg_plan.DurationMode = int(duration_mode)  # type: ignore
    kf = float(keyframe_time) if keyframe_time.strip() else mode / 2.0
    params = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=mode,
        clip_start=clip_start_f,
        keyframe_time=kf,
        fallback=fallback,  # type: ignore
        codec=codec,  # type: ignore
        muted=_parse_bool(muted),
        audio_fade_secs=fade_f,
        content_identifier=content_identifier.strip(),
    )

    try:
        result = await asyncio.to_thread(livephoto.run_livephoto_job, src, d, params)
    except subprocess.CalledProcessError as e:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(500, f"FFmpeg 转码失败：{(e.stderr or '')[-500:]}")
    except (ValueError, RuntimeError) as e:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(422, str(e))

    meta = {
        "content_identifier": result.content_identifier,
        "export_duration": round(result.export_duration, 2),
        "still_image_time": result.still_image_time,
        "clip_start": round(result.clip_start, 2),
        "keyframe_time": round(result.keyframe_time, 2),
        "needs_fallback": result.needs_fallback,
        "fallback": result.fallback,
        "codec": codec,
        "muted": params.muted,
        "metadata_notes": result.metadata_notes,
    }
    _JOBS[job_id] = {"dir": str(d), "meta": meta}
    return {
        "job_id": job_id,
        "still_url": f"/api/jobs/{job_id}/still.jpg",
        "mov_url": f"/api/jobs/{job_id}/live.mov",
        "download_url": f"/api/jobs/{job_id}/download",
        "meta": meta,
    }


@router.get("/jobs/{job_id}/download")
async def download_job(job_id: str):
    d = _job_dir(job_id)
    still, mov = d / "still.jpg", d / "live.mov"
    if not (still.exists() and mov.exists()):
        raise HTTPException(404, "任务不存在或已过期")
    zpath = d / "livephoto.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(still, "still.jpg")
        z.write(mov, "live.mov")
    return FileResponse(zpath, media_type="application/zip", filename="livephoto.zip")


@router.get("/jobs/{job_id}/{filename}")
async def get_job_file(job_id: str, filename: str):
    if filename not in ("still.jpg", "live.mov"):
        raise HTTPException(404, "文件不存在")
    d = _job_dir(job_id)
    p = d / filename
    if not p.exists():
        raise HTTPException(404, "任务不存在或已过期")
    media = "image/jpeg" if filename == "still.jpg" else "video/quicktime"
    return FileResponse(p, media_type=media, filename=filename)
