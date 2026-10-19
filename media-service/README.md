# LiveCraft media-service（阶段三）

FastAPI 媒体微服务：把前端交互原型背后的三条真实处理管道落地。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/live-photo` | POST | 视频转实况：上传视频 + 参数 → 返回 `still.jpg` + `live.mov`（ContentIdentifier 严格配对） |
| `/api/jobs/{id}/still.jpg` · `/live.mov` | GET | 拉取任务产物 |
| `/api/jobs/{id}/download` | GET | 打包下载 zip（still.jpg + live.mov） |
| `/api/parser` | POST | 短视频分享链接解析 → 无水印视频播放/下载地址（抖音/快手/小红书/TikTok，多策略容错） |
| `/api/parser/media` | GET | 解析结果的短期签名媒体代理（补 Referer，支持 Range 拖动播放） |
| `/api/inpaint` | POST | 图片去水印：原图 + 掩膜 → 修复后 PNG（OpenCV TELEA/NS，缺失时 PIL 兜底） |
| `/api/health` | GET | 健康检查（ffmpeg 版本、opencv 可用性） |

## 参数约定（与前端 `lib/livephoto.ts` 一一对应）

`duration_mode`（3|5）、`clip_start`、`keyframe_time`、`fallback`（pingpong|slowdown|keep）、
`codec`（h264|hevc）、`muted`、`audio_fade_secs`、`content_identifier`（不传则服务端生成 UUID）。

处理逻辑在 `app/services/ffmpeg_plan.py`：兼容的 H.264 / HEVC 视频优先 `-c:v copy`
原码流复制，仅在编码 / 像素格式不兼容，或短片需要正倒放、慢放补帧时转码；音频在不兼容时
单独转 AAC。裁切边界受源视频关键帧影响，流复制成片可能比目标时长多约 0.1–0.2 秒。

MOV 的 Apple 元数据由自定义 `app/services/livephoto_mov.py` 写入：不重编码视频，向
`mdat` 追加 `still-image-time` 定时元数据样本、向 `moov` 追加元数据轨和
`com.apple.quicktime.content.identifier`，并修正既有 `stco/co64` chunk offset。
JPG 由 piexif 把同一 UUID 写入 Apple EXIF MakerNote tag 17；任务结束前会回读校验
JPG / MOV 标识一致。**真机（iPhone 相册）验证元数据键名后，如需微调优先改
`app/services/livephoto_mov.py`。**

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

用 FFmpeg 合成测试视频走完全流程：3s/5s 裁剪、流复制 / 兼容转码判定、音频转码标记、
兜底策略、元数据回读校验、ZIP 同名配对、parser 平台识别、inpaint 修复。
当前结果：**36 passed, 0 failed**。

## 解析器说明

`app/services/parser.py` 实现「分享文本 → 域名识别 → 短链跳转（移动 UA）→
页面 JSON 正则 / 官方 API / 备用解析服务」的多重容错管道。抖音与 TikTok 的网页接口
已启用 `a_bogus` / `uifid` 等签名校验，官方页面在无 Cookie 时不再返回 `aweme_detail`；
因此优先使用可配置的 dtk 兼容解析服务，并通过 `/api/parser/media` 为 CDN 直链补上
Referer 与 Range，浏览器才能真正播放和下载。各平台反爬频繁变化，网络失败会收敛为
结构化 `error_code`（unknown_platform / network / login_required / not_found /
extract_failed），前端据此给用户明确提示而非笼统报错。

解析兜底默认使用 `https://api.douyin.wtf` 的公开演示身份。它会收到用户提交的分享链接；
生产环境请设置 `PARSER_FALLBACK_API_URL`，并提供自建实例的 API Key 或账号，或用
`PARSER_FALLBACK_DEMO=0` 关闭。多 worker 部署时固定设置 `PARSER_PROXY_SECRET`。
