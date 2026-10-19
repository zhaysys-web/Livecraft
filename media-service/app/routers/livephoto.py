"""POST /api/live-photo: convert a video into an Apple Live Photo pair.

Response JSON: { job_id, still_url, mov_url, download_url, meta{...} }
JPG/MOV can be fetched separately for Web Share, or as a same-basename ZIP for
the compatibility fallback.
"""

from __future__ import annotations

import asyncio
import json
import re
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

_JOB_ID_RE = re.compile(r"^[a-f0-9]{12}$")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# 转码并发控制：FFmpeg 是 CPU 密集型，超过上限的请求排队等待
_transcode_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_JOBS)


def _livephoto_root() -> Path:
    return (config.DATA_DIR / "livephoto").resolve()


def _job_dir(job_id: str, *, create: bool = False) -> Path:
    if not _JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(404, "任务不存在或已过期")
    root = _livephoto_root()
    directory = (root / job_id).resolve()
    if directory.parent != root:
        raise HTTPException(404, "任务不存在或已过期")
    if create:
        directory.mkdir(parents=True, exist_ok=True)
    return directory


def _sweep_expired() -> None:
    base = _livephoto_root()
    if not base.exists():
        return
    now = time.time()
    try:
        entries = list(base.iterdir())
    except OSError:
        return
    for directory in entries:
        try:
            if (
                directory.is_dir()
                and now - directory.stat().st_mtime > config.JOB_TTL_SECONDS
            ):
                shutil.rmtree(directory, ignore_errors=True)
        except OSError:
            continue


def _read_meta(directory: Path) -> dict:
    try:
        return json.loads((directory / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "on")


def _safe_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix):
        return suffix
    return ".mp4"


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

    mode: ffmpeg_plan.DurationMode = int(duration_mode)  # type: ignore[assignment]
    try:
        keyframe_f = (
            float(keyframe_time)
            if keyframe_time.strip()
            else -1.0
        )
    except ValueError:
        raise HTTPException(400, "keyframe_time 必须是数字")

    identifier = content_identifier.strip()
    if identifier and not _UUID_RE.fullmatch(identifier):
        raise HTTPException(400, "content_identifier 必须是标准 UUID")

    job_id = uuid.uuid4().hex[:12]
    directory = _job_dir(job_id, create=True)
    src = directory / f"input{_safe_suffix(video.filename)}"

    size = 0
    try:
        with src.open("wb") as output:
            while chunk := await video.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise HTTPException(
                        413, f"文件超过 {config.MAX_UPLOAD_MB}MB 上限"
                    )
                output.write(chunk)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    if size == 0:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(400, "上传的视频文件为空")

    params = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=mode,
        clip_start=clip_start_f,
        keyframe_time=keyframe_f,
        fallback=fallback,  # type: ignore[arg-type]
        codec=codec,  # type: ignore[arg-type]
        muted=_parse_bool(muted),
        audio_fade_secs=fade_f,
        content_identifier=identifier,
        prefer_copy=True,
    )

    try:
        async with _transcode_semaphore:
            result = await asyncio.to_thread(
                livephoto.run_livephoto_job, src, directory, params
            )
    except subprocess.CalledProcessError as exc:
        shutil.rmtree(directory, ignore_errors=True)
        detail = (exc.stderr or "FFmpeg 处理失败").strip()[-800:]
        raise HTTPException(422, f"视频处理失败：{detail}") from exc
    except (ValueError, RuntimeError) as exc:
        shutil.rmtree(directory, ignore_errors=True)
        raise HTTPException(422, str(exc)) from exc
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise

    src.unlink(missing_ok=True)

    meta = {
        "content_identifier": result.content_identifier,
        "file_base_name": result.file_base_name,
        "export_duration": round(result.export_duration, 2),
        "output_duration": round(result.output_duration, 2),
        "still_image_time": round(result.still_image_time, 3),
        "keyframe_offset": round(result.keyframe_offset, 2),
        "clip_start": round(result.clip_start, 2),
        "keyframe_time": round(result.keyframe_time, 2),
        "needs_fallback": result.needs_fallback,
        "fallback": result.fallback,
        "codec": codec,
        "muted": params.muted,
        "video_action": result.video_action,
        "audio_action": result.audio_action,
        "no_reencode": (
            result.video_action == "copy"
            and result.audio_action in ("copy", "none")
        ),
        "source_video_codec": result.source_video_codec,
        "source_pix_fmt": result.source_pix_fmt,
        "metadata_notes": result.metadata_notes,
        "warnings": result.warnings,
    }
    (directory / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )

    return {
        "job_id": job_id,
        "still_url": f"/api/jobs/{job_id}/still.jpg",
        "mov_url": f"/api/jobs/{job_id}/live.mov",
        "download_url": f"/api/jobs/{job_id}/download",
        "meta": meta,
    }


@router.get("/jobs/{job_id}/download")
async def download_job(job_id: str):
    directory = _job_dir(job_id)
    still, mov = directory / "still.jpg", directory / "live.mov"
    if not (still.exists() and mov.exists()):
        raise HTTPException(404, "任务不存在或已过期")

    base_name = str(_read_meta(directory).get("file_base_name") or "LivePhoto")
    archive_path = directory / f"{base_name}.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(still, f"{base_name}.JPG")
        archive.write(mov, f"{base_name}.MOV")
    return FileResponse(
        archive_path,
        media_type="application/zip",
        filename=f"{base_name}.zip",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/jobs/{job_id}/{filename}")
async def get_job_file(job_id: str, filename: str):
    if filename not in ("still.jpg", "live.mov"):
        raise HTTPException(404, "文件不存在")
    path = _job_dir(job_id) / filename
    if not path.exists():
        raise HTTPException(404, "任务不存在或已过期")
    media_type = "image/jpeg" if filename == "still.jpg" else "video/quicktime"
    return FileResponse(
        path,
        media_type=media_type,
        filename=filename,
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    directory = _job_dir(job_id)
    if not directory.exists():
        return {"ok": True}
    shutil.rmtree(directory, ignore_errors=True)
    return {"ok": True}
