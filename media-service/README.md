# LiveCraft media-service（阶段三）

FastAPI 媒体微服务：把前端交互原型背后的三条真实处理管道落地。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/live-photo` | POST | 视频转实况：上传视频 + 参数 → 返回 `still.jpg` + `live.mov`（ContentIdentifier 严格配对） |
| `/api/jobs/{id}/still.jpg` · `/live.mov` | GET | 拉取任务产物 |
| `/api/jobs/{id}/download` | GET | 打包下载 zip（still.jpg + live.mov） |
| `/api/parser` | POST | 短视频分享链接解析 → 无水印视频直链（抖音/快手/小红书/TikTok，多策略容错） |
| `/api/inpaint` | POST | 图片去水印：原图 + 掩膜 → 修复后 PNG（OpenCV TELEA/NS，缺失时 PIL 兜底） |
| `/api/health` | GET | 健康检查（ffmpeg 版本、opencv 可用性） |

## 参数约定（与前端 `lib/livephoto.ts` 一一对应）

`duration_mode`（3|5）、`clip_start`、`keyframe_time`、`fallback`（pingpong|slowdown|keep）、
`codec`（h264|hevc）、`muted`、`audio_fade_secs`、`content_identifier`（不传则服务端生成 UUID）。

转码逻辑是 `lib/livephoto.ts` 中 `buildFfmpegArgs` 的逐行 Python 移植
（`app/services/ffmpeg_plan.py`），滤镜链、兜底策略、音频淡入淡出、`still-image-time`
四舍五入规则完全一致。`.mov` 的 `com.apple.quicktime.content-identifier` 由 FFmpeg
直接写入；静态图用 piexif 把同一 UUID 写入 EXIF MakerNote（等价于
`exiftool -MakerNotes:ContentIdentifier=`）。**真机（iPhone 相册）验证元数据键名后，
如需微调只改 `app/services/metadata.py`。**

## 本地运行

```bash
cd media-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # 按需改 CORS / 端口
.venv/bin/python -m app.main   # http://localhost:8000
```

前端联调用 `NEXT_PUBLIC_MEDIA_SERVICE_URL=http://localhost:8000`（见 `lib/media-client.ts`）。

## Docker / 生产部署

```bash
docker build -t livecraft-media .
docker run -d --name livecraft-media -p 8000:8000 \
  -e CORS_ORIGINS=https://你的前端域名 \
  -v livecraft-data:/data \
  livecraft-media
```

阶段五规划：前端放 Vercel，本服务放 Railway / Render / 自有云服务器（反向代理 + HTTPS
参考主仓库 README 的阶段五章节）。云服务器在国内需备案才可开 443，参考已有方案
（香港/海外节点或 Cloudflare Tunnel）。

## 自检

```bash
.venv/bin/python tests/smoke_test.py
```

用 FFmpeg 合成测试视频走完全流程：3s/5s 裁剪、兜底策略、元数据回读校验、
parser 平台识别、inpaint 修复。

## 解析器说明

`app/services/parser.py` 实现「分享文本 → 域名识别 → 短链跳转（移动 UA）→
页面 JSON 正则 / 官方 API / 第三方引擎兜底」的多重容错管道。各平台反爬频繁变化，
网络失败会收敛为结构化 `error_code`（unknown_platform / network / login_required /
not_found / extract_failed），前端据此给用户明确提示而非笼统报错。
