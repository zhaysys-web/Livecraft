"""阶段三冒烟测试：合成视频走完全流程，断言产物与元数据。

运行：.venv/bin/python tests/smoke_test.py
"""

from __future__ import annotations

import io
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import ffmpeg_plan, inpaint as inpaint_svc, livephoto, metadata, parser as parser_svc  # noqa: E402

PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    (PASS if cond else FAIL).append(name)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))


def make_video(path: Path, duration: float):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=640x360:rate=30:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(path),
    ]
    subprocess.run(cmd, capture_output=True, check=True, timeout=120)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="livecraft-smoke-"))
    print(f"workdir: {tmp}")

    # ---------- 合成测试视频 ----------
    long_v = tmp / "long.mp4"
    short_v = tmp / "short.mp4"
    make_video(long_v, 8.0)
    make_video(short_v, 2.5)
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
    check("mov ContentIdentifier 配对",
          metadata.read_mov_tags(r.mov_path).get("com.apple.quicktime.content-identifier")
          == "11111111-2222-3333-4444-555555555555")
    check("jpg MakerNote 配对",
          metadata.read_jpg_content_identifier(r.still_path)
          == "11111111-2222-3333-4444-555555555555")
    check("still-image-time=4（3.5 四舍五入）", r.still_image_time == 4, str(r.still_image_time))

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
            data={"duration_mode": "3", "clip_start": "1", "keyframe_time": "2.5",
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
