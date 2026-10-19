"""阶段三冒烟测试：合成视频走完全流程，断言产物与元数据。

运行：.venv/bin/python tests/smoke_test.py
"""

from __future__ import annotations

import io
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import ffmpeg_plan, inpaint as inpaint_svc, livephoto, livephoto_mov, metadata, parser as parser_svc  # noqa: E402

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    (PASS if cond else FAIL).append(name)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))


def make_video(path: Path, duration: float, with_audio: bool = True):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=640x360:rate=30:duration={duration}",
    ]
    if with_audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
    if with_audio:
        cmd += ["-c:a", "aac", "-shortest"]
    cmd.append(str(path))
    subprocess.run(cmd, capture_output=True, check=True, timeout=120)


def make_vp9_video(path: Path, duration: float):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=24:duration={duration}",
        "-c:v", "libvpx-vp9", "-b:v", "220k", "-pix_fmt", "yuv420p", str(path),
    ]
    subprocess.run(cmd, capture_output=True, check=True, timeout=120)


def make_opus_audio_video(path: Path, duration: float):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=24:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "libopus", "-shortest", str(path),
    ]
    subprocess.run(cmd, capture_output=True, check=True, timeout=120)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="livecraft-smoke-"))
    print(f"workdir: {tmp}")

    # ---------- 合成测试视频 ----------
    long_v = tmp / "long.mp4"
    short_v = tmp / "short.mp4"
    silent_v = tmp / "silent.mp4"
    vp9_v = tmp / "vp9.webm"
    opus_v = tmp / "h264-opus.mkv"
    make_video(long_v, 8.0)
    make_video(short_v, 2.5)
    make_video(silent_v, 6.0, with_audio=False)
    make_vp9_video(vp9_v, 4.0)
    make_opus_audio_video(opus_v, 4.0)
    long_info = ffmpeg_plan.probe_video(long_v)
    check("probe 8s 视频", abs(long_info["duration"] - 8.0) < 0.3 and long_info["has_audio"],
          str(long_info))

    # ---------- 常规 3s 裁剪 ----------
    p = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=3, clip_start=2.0, keyframe_time=3.5,
        fallback="pingpong", codec="h264", muted=False, audio_fade_secs=0.2,
        content_identifier="11111111-2222-3333-4444-555555555555",
    )
    r = livephoto.run_livephoto_job(long_v, tmp / "job1", p)
    check("3s 产物存在", r.still_path.exists() and r.mov_path.exists())
    dur = metadata.read_mov_duration(r.mov_path)
    check("3s 导出时长≈3.0", abs(dur - 3.0) < 0.25, f"got {dur}")
    check("3s 走原画质流复制", r.video_action == "copy" and r.audio_action == "copy",
          f"{r.video_action}/{r.audio_action}")
    check("mov ContentIdentifier 配对",
          metadata.read_mov_tags(r.mov_path).get(metadata.CONTENT_IDENTIFIER_KEY)
          == "11111111-2222-3333-4444-555555555555")
    check("jpg MakerNote 配对",
          metadata.read_jpg_content_identifier(r.still_path)
          == "11111111-2222-3333-4444-555555555555")
    # 严格校验 MakerNote 是标准 TIFF（iOS 用严格解析器读 key 17，
    # 魔数不是 42 会导致整个 MakerNote 被拒、无法配对）
    import struct as _struct
    _raw = r.still_path.read_bytes()
    _i = _raw.find(b"Apple iOS\x00")
    _tiff = _raw[_i + 10:_i + 10 + 32]
    _magic = _struct.unpack(">H", _tiff[2:4])[0]
    _ifd = _struct.unpack(">I", _tiff[4:8])[0]
    _tag, _typ, _cnt, _voff = _struct.unpack(">HHII", _tiff[_ifd + 2:_ifd + 14])
    check("jpg MakerNote 是标准 TIFF（magic=42, tag=17, ASCII）",
          _magic == 42 and _tag == 17 and _typ == 2 and _cnt == 37,
          f"magic={_magic} tag={_tag} type={_typ} count={_cnt}")
    # 文件对整体校验（模拟 iOS 配对逻辑）
    _pair_problems = metadata.validate_live_photo_pair(r.still_path, r.mov_path)
    check("文件对通过 Live Photo 配对校验", not _pair_problems,
          "; ".join(_pair_problems) if _pair_problems else "")
    # 反例：旧的坏格式必须被校验器拦下
    import piexif as _piexif
    _bad = _piexif.load(r.still_path.read_bytes())
    _bad["Exif"][_piexif.ExifIFD.MakerNote] = (
        bytes.fromhex("4170706c6520694f530000014d4d000100110002000000250000002000000000")
        + b"11111111-2222-3333-4444-555555555555\x00"
    )
    _bad_path = tmp / "bad.jpg"
    _bad_path.write_bytes(r.still_path.read_bytes())
    _piexif.insert(_piexif.dump(_bad), str(_bad_path))
    _bad_problems = metadata.validate_live_photo_pair(_bad_path, r.mov_path)
    check("校验器能识别旧坏格式（魔数错误）", any("魔数" in p for p in _bad_problems),
          "; ".join(_bad_problems) if _bad_problems else "未检出问题")
    live_meta = livephoto_mov.read_apple_metadata(r.mov_path)
    check("still-image-time 写入时间轨且使用片段内相对时间",
          abs(live_meta.still_time - 1.5) < 0.01
          and abs(r.still_image_time - 1.5) < 0.01
          and live_meta.asset_id == r.content_identifier,
          f"track={live_meta.still_time}, result={r.still_image_time}")

    # ---------- 5s 模式 ----------
    p5 = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=5, clip_start=1.0, keyframe_time=3.5,
        fallback="pingpong", codec="hevc", muted=True,
    )
    r5 = livephoto.run_livephoto_job(long_v, tmp / "job5", p5)
    dur5 = metadata.read_mov_duration(r5.mov_path)
    check("5s 导出时长≈5.0", abs(dur5 - 5.0) < 0.3, f"got {dur5}")
    check("服务端自动生成 UUID", len(r5.content_identifier) == 36, r5.content_identifier)

    # ---------- 兜底策略（2.5s 源 → 5s 目标）----------
    for fb in ("pingpong", "slowdown", "keep"):
        pf = ffmpeg_plan.LivePhotoJobParams(
            duration_mode=5, keyframe_time=1.0, fallback=fb,  # type: ignore
            codec="h264", muted=False,
        )
        rf = livephoto.run_livephoto_job(short_v, tmp / f"jobfb-{fb}", pf)
        d = metadata.read_mov_duration(rf.mov_path)
        expect = 2.5 if fb == "keep" else 5.0
        check(f"兜底 {fb} 时长≈{expect}", abs(d - expect) < 0.4, f"got {d}")
        check(f"兜底 {fb} 标记 needs_fallback", rf.needs_fallback)

    # ---------- 无音轨也必须能生成 ----------
    ps = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=3, clip_start=1.0, keyframe_time=2.0,
        fallback="pingpong", codec="h264", muted=False,
    )
    rs = livephoto.run_livephoto_job(silent_v, tmp / "job-silent", ps)
    check("无音轨视频不报错", rs.mov_path.exists() and rs.audio_action == "none")

    # ---------- QuickTime 不兼容的 VP9 自动回退转码 ----------
    pv = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=3, clip_start=0.5, keyframe_time=1.5,
        fallback="pingpong", codec="h264", muted=True,
    )
    rv = livephoto.run_livephoto_job(vp9_v, tmp / "job-vp9", pv)
    check("VP9 自动回退兼容转码", rv.video_action == "reencode",
          f"got {rv.video_action}")

    # ---------- 视频可复制、音频需转码时不能谎报“未转码” ----------
    pa = ffmpeg_plan.LivePhotoJobParams(
        duration_mode=3, clip_start=0.5, keyframe_time=1.5,
        fallback="pingpong", codec="h264", muted=False,
    )
    ra = livephoto.run_livephoto_job(opus_v, tmp / "job-opus", pa)
    check("H.264 视频复制 + Opus 音频转码",
          ra.video_action == "copy" and ra.audio_action == "reencode",
          f"{ra.video_action}/{ra.audio_action}")

    # ---------- parser：离线平台识别 ----------
    samples = {
        "https://v.douyin.com/abc123/": "douyin",
        "https://v.kuaishou.com/xyz": "kuaishou",
        "https://xhslink.com/a/b": "xiaohongshu",
        "https://vt.tiktok.com/ZZZ/": "tiktok",
    }
    for url, plat in samples.items():
        try:
            got = parser_svc.detect_platform(parser_svc.extract_share_url(f"分享：{url} 来看"))
            check(f"parser 识别 {plat}", got == plat, f"got {got}")
        except parser_svc.ParserError as e:
            check(f"parser 识别 {plat}", False, str(e))
    try:
        parser_svc.detect_platform("https://example.com/nope")
        check("parser 未知平台抛错", False)
    except parser_svc.ParserError as e:
        check("parser 未知平台抛错", e.code == "unknown_platform", e.code)

    media_url = "https://v3-web.douyinvod.com/demo/video.mp4?token=abc"
    proxy_path = parser_svc.make_media_proxy_path(media_url)
    proxy_query = parse_qs(urlsplit(proxy_path).query)
    check(
        "parser 媒体代理签名可回验",
        parser_svc.verify_media_proxy(
            proxy_query["token"][0],
            proxy_query["exp"][0],
            proxy_query["download"][0],
            proxy_query["sig"][0],
        ) == media_url,
    )
    check(
        "parser 媒体代理拒绝篡改签名",
        parser_svc.verify_media_proxy(
            proxy_query["token"][0],
            proxy_query["exp"][0],
            proxy_query["download"][0],
            "bad-signature",
        ) == "",
    )
    check("parser 媒体代理拒绝非 CDN 域名",
          not parser_svc.validate_media_url("http://127.0.0.1/private"))

    # ---------- inpaint ----------
    from PIL import Image, ImageDraw  # noqa: E402
    img = Image.new("RGB", (128, 128), (200, 30, 30))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 88, 88], fill=(30, 30, 200))
    mask = Image.new("L", (128, 128), 0)
    ImageDraw.Draw(mask).rectangle([40, 40, 88, 88], fill=255)
    ib, mb = io.BytesIO(), io.BytesIO()
    img.save(ib, format="PNG"); mask.save(mb, format="PNG")
    out = inpaint_svc.inpaint(ib.getvalue(), mb.getvalue(), "telea", 3)
    check("inpaint 输出有效 PNG", out[:8] == b"\x89PNG\r\n\x1a\n" and len(out) > 100)
    out_img = Image.open(io.BytesIO(out))
    center = out_img.getpixel((64, 64))
    check("inpaint 修复区不再是纯蓝块", center[2] < 200, str(center))

    # ---------- FastAPI 端点 ----------
    from fastapi.testclient import TestClient  # noqa: E402
    from app.main import app  # noqa: E402

    client = TestClient(app)
    h = client.get("/api/health")
    check("GET /api/health", h.status_code == 200 and h.json()["ok"], h.text[:200])

    with long_v.open("rb") as f:
        resp = client.post(
            "/api/live-photo",
            files={"video": ("long.mp4", f, "video/mp4")},
            data={"duration_mode": "3", "clip_start": "1", "keyframe_time": "",
                  "fallback": "pingpong", "codec": "h264", "muted": "false"},
        )
    check("POST /api/live-photo 200", resp.status_code == 200, resp.text[:300])
    if resp.status_code == 200:
        body = resp.json()
        s = client.get(body["still_url"])
        m = client.get(body["mov_url"])
        z = client.get(body["download_url"])
        check("产物可下载", s.status_code == 200 and m.status_code == 200 and z.status_code == 200)
        check("meta 回传 UUID", len(body["meta"]["content_identifier"]) == 36)
        check("空白封面帧自动取片段中点",
              abs(body["meta"]["keyframe_time"] - 2.5) < 0.05,
              str(body["meta"]["keyframe_time"]))
        check("接口返回原画质标记", body["meta"]["no_reencode"] is True)
        check("接口返回浮点 still-image-time",
              abs(body["meta"]["still_image_time"] - 1.5) < 0.01,
              str(body["meta"]["still_image_time"]))
        base = body["meta"]["file_base_name"]
        with zipfile.ZipFile(io.BytesIO(z.content)) as archive:
            names = set(archive.namelist())
        check("ZIP 内 JPG/MOV 同名",
              names == {f"{base}.JPG", f"{base}.MOV"}, str(names))

    with opus_v.open("rb") as f:
        resp_opus = client.post(
            "/api/live-photo",
            files={"video": ("h264-opus.mkv", f, "video/x-matroska")},
            data={"duration_mode": "3", "clip_start": "0.5",
                  "keyframe_time": "1.5", "fallback": "pingpong",
                  "codec": "h264", "muted": "false"},
        )
    check("API 不把音频转码谎报为完全未转码",
          resp_opus.status_code == 200
          and resp_opus.json()["meta"]["video_action"] == "copy"
          and resp_opus.json()["meta"]["audio_action"] == "reencode"
          and resp_opus.json()["meta"]["no_reencode"] is False,
          resp_opus.text[:300])

    resp2 = client.post(
        "/api/inpaint",
        files={"image": ("img.png", ib.getvalue(), "image/png"),
               "mask": ("mask.png", mb.getvalue(), "image/png")},
        data={"method": "telea", "radius": "3"},
    )
    check("POST /api/inpaint 200+PNG",
          resp2.status_code == 200 and resp2.headers["content-type"] == "image/png",
          resp2.text[:200] if resp2.status_code != 200 else resp2.headers.get("X-Inpaint-Engine", ""))

    resp3 = client.post("/api/parser", json={"share_text": "看看这个 https://example.com/xyz"})
    check("POST /api/parser 未知平台→422 结构化错误",
          resp3.status_code == 422 and resp3.json().get("error_code") == "unknown_platform",
          resp3.text[:200])

    print(f"\n==== {len(PASS)} passed, {len(FAIL)} failed ====")
    if FAIL:
        print("FAILED:", FAIL)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
