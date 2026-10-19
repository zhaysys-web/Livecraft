# LiveCraft / 灵动映像 —— 项目交接说明

> 写给接手的 AI（Codex）：先读这份说明，再改代码。

## 项目简介

多媒体工具 Web 应用，三个工具：

1. **实况工坊**（`/live-photo`）：视频转 Apple Live Photo（同名 JPG + MOV，ContentIdentifier 严格匹配）
2. **短视频解析**（`/parser`）：抖音 / 快手 / 小红书 / TikTok 分享口令解析出无水印视频直链
3. **去水印**（`/inpaint`）：图片水印 / 杂物局部修复（本地快速擦除 + 后端 AI 高精度二选一）

## 技术栈

- 前端：Next.js 14 + TypeScript + Tailwind CSS（`app/`、`components/`、`lib/`、`hooks/`）
- 后端：FastAPI + FFmpeg + OpenCV（`media-service/`）
  - `POST /api/live-photo`（multipart：video + 参数）→ `{job_id, still_url, mov_url, download_url, meta}`
  - `POST /api/parser`（JSON `{share_text}`）
  - `POST /api/inpaint`（multipart：image + mask）
- 部署：前端 Vercel + 后端 Render（Docker，`render.yaml`）

## 线上状态

| 项 | 地址 / 说明 |
|---|---|
| GitHub | `zhaysys-web/Livecraft`（Public，分支 main） |
| 前端 | https://livecraft-ten.vercel.app |
| 后端 | https://livecraft-media.onrender.com（Render Free） |
| 前端环境变量 | `NEXT_PUBLIC_MEDIA_SERVICE_URL=https://livecraft-media.onrender.com`，类型选 Config，不能选 Secret |

注意：

- `livecraft.vercel.app` 是另一个旧项目，和本项目无关。
- `-juno-4f9a.vercel.app` 结尾的部署地址有 Vercel 登录墙。
- Render 免费版 15 分钟无请求会休眠，首次唤醒约 30–60 秒；前端状态短暂显示“服务未连接”后刷新即可。
- 线上前端必须重新部署本次代码，才会包含“直接存入相册”与不重编码链路。

## 实况照片当前实现（2026-10-19）

### 生成链路

- 3 秒 / 5 秒分段控制，默认 3 秒。
- 上传后可拖动定长裁剪窗口，预览播放器在选中区间循环。
- 可在区间内拖琥珀色游标选择 Key Photo。
- 后端 `ffprobe` 探测源参数；H.264 / HEVC（兼容像素格式）走视频流复制，不重新编码。
- 仅当源编码不适合 QuickTime、像素格式不兼容，或短片需要正倒放/慢放补帧时才转码。
- `media-service/app/services/livephoto_mov.py` 在 MOV 中追加 `still-image-time` 元数据轨并写入 `com.apple.quicktime.content.identifier`，同时修正 `stco/co64`。
- JPG 通过 Apple MakerNote tag 17 写入同一 UUID；生成后回读校验 JPG / MOV 标识一致。

### 保存链路

- 转换完成后前端立刻预取同名 `.JPG` / `.MOV`，封装为两个 `File`：
  - `IMG_xxx.JPG`，`image/jpeg`
  - `IMG_xxx.MOV`，`video/quicktime`
- 结果页主按钮始终为 **「直接存入相册」**；点击处理函数中同步调用 `navigator.canShare` 与 `navigator.share({ files })`，中间没有 `await` 或网络请求。
- iOS 系统面板选择 **「存储 2 个项目」**，无需解压 ZIP。
- ZIP 下载永远保留为次要兜底。
- 文件分享 API 需要安全上下文：正式使用必须是 HTTPS；`http://192.168.x.x` 局域网地址只能走 ZIP。

### 已验证

- `npm run typecheck` 通过。
- `npm run build` 通过。
- `python media-service/tests/smoke_test.py`：**36 passed, 0 failed**。
- 真实浏览器上传 15 秒视频：3s / 5s 切换、定长滑窗、封面游标、区间循环正常。
- 浏览器注入 `navigator.share` 后核对：两个 File 同名、MIME 正确、点击时立即触发分享。
- 移动端 390×844 完成页不空白，主按钮与 ZIP 兜底均可见。

## 本地运行

```bash
# 后端
cd media-service
python -m venv .venv
.venv\Scripts\python -m app.main   # Windows；Linux/macOS 用 .venv/bin/python

# 前端（另开终端）
npm install
$env:NEXT_PUBLIC_MEDIA_SERVICE_URL="http://localhost:8000"
npm run dev
```

## 已知限制 / 待办

1. **iPhone 真机未验证**：桌面浏览器自动化无法替代 Safari 真机的系统分享面板与相册自动合并验证。发布前用 iPhone Safari 实测一次「存储 2 个项目」。
2. 视频流复制不能做帧精确裁切：边界受关键帧影响，成片可能比目标时长多约 0.1–0.2 秒；不要为了精确时长偷偷改成全量转码。
3. 手机访问 `http://192.168.x.x` 不能直存；需要 HTTPS 公网地址或 HTTPS tunnel。
4. 如果前端通过 tunnel 暴露，`NEXT_PUBLIC_MEDIA_SERVICE_URL` 也必须指向手机可访问的 HTTPS 后端，不能是 `localhost`。
5. parser 真实抓取依赖公网可达，受限网络会返回结构化网络错误。
6. 后端 `MAX_UPLOAD_MB=500`，前端 Dropzone 限 200MB。

## 不要做

- 不要修改或停止 `localhost:3101` 上的旧项目 `live-photo-studio`。
- 不要在 `npm run dev` 仍占用 `.next` 时执行 `npm run build`。
- 不要为了“精确 5.00 秒”把兼容视频强制重编码。
