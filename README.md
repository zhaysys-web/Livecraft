# LiveCraft / 灵动映像

高美感多媒体处理工作台：**视频转 Apple Live Photo**、**短视频无水印解析**、**图片去水印擦除**，
三件工具，一个深色沉浸式界面。

## ✨ 三个工具

| 工具 | 能做什么 |
| ---- | -------- |
| **实况工坊** | 视频转 iPhone 实况照片。3 秒 / 5 秒定长滑窗裁剪、封面帧任选、兼容视频原码流复制不重编码，支持 iOS 系统面板直接存入相册 |
| **无水印解析** | 粘贴抖音 / 快手 / 小红书 / TikTok 分享口令，解析出可播放、可下载的无水印视频 |
| **去水印橡皮擦** | 画笔涂抹水印区域，本地快速擦除与 AI 高精度修复双通道，支持撤销重做、Before-After 对比 |

后端没启动时不会伪造处理结果：页面会明确提示服务未连接，生成请求会直接报错，便于排查部署问题。

## 🚀 在线体验

部署完成后地址填这里：

- 前端：`https://<your-app>.vercel.app`

## 💻 本地运行

### 只看界面（不接后端）

```bash
npm install
npm run dev        # http://localhost:3000
```

> 不启动后端时只能浏览界面；点击生成会提示“服务未连接”，不会生成演示文件。

### 完整功能（前端 + 后端）

后端需要本机装好 FFmpeg：

```bash
cd media-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.main          # http://localhost:8000，/docs 看接口文档
```

前端（新开一个终端）：

```bash
NEXT_PUBLIC_MEDIA_SERVICE_URL=http://localhost:8000 npm run dev
```

或一条命令全起：

```bash
docker compose up --build   # 前端 :3000，后端 :8000
```

## 📱 手机保存实况照片

实况工坊的结果页以 **「直接存入相册」** 为主按钮，ZIP 仅作兜底：

1. 转换完成后，前端会预取同名 `IMG_xxxx.JPG` 与 `IMG_xxxx.MOV`。
2. 点「直接存入相册」会同步唤起系统分享面板。
3. iPhone 上选择 **「存储 2 个项目」**，系统相册会自动合并成一张实况照片，不需要解压 ZIP。

注意事项：

- **同一 Wi-Fi 预览**：手机访问 `http://<电脑局域网IP>:3102/live-photo` 可以打开界面；但 HTTP 下只能 ZIP，不能直存。前端连接的后端地址也要能在手机上访问，不能是 `localhost`。
- **必须使用 HTTPS 页面**（`https://...`）。`http://192.168.x.x` 这类局域网 HTTP 地址无法使用文件分享 API，只能下载 ZIP。
- iPhone 推荐 Safari；Android 与桌面浏览器是否支持多文件分享取决于系统实现。
- 兼容 H.264 / HEVC 的视频会原码流复制，不重新编码；裁切边界受源视频关键帧影响，成片时长可能有约 0.1–0.2 秒误差。
- 手机需要通过公网 HTTPS 地址访问，并确保前端能访问公网后端；不能把 `localhost` 当作手机上的后端地址。

## ☁️ 公开发布（全免费，约 10 分钟）

架构：**Vercel**（前端，Hobby 免费版）+ **Render**（后端 Docker，免费版），0 元。

完整步骤见 **[DEPLOY.md](./DEPLOY.md)**，核心就三步：

1. 把本仓库推到 GitHub
2. Render → New → Blueprint → 选仓库 → Apply，拿到后端地址
3. Vercel → 导入仓库 → 环境变量填 `NEXT_PUBLIC_MEDIA_SERVICE_URL=后端地址` → Deploy

> 顺序别反：先部署后端拿到地址，再部署前端（地址在构建时烘焙进前端）。

## ⚙️ 环境变量

详见 [.env.example](./.env.example)。关键的只有两个：

| 变量 | 在哪填 | 说明 |
| ---- | ------ | ---- |
| `NEXT_PUBLIC_MEDIA_SERVICE_URL` | Vercel | 后端公网地址，如 `https://livecraft-media.onrender.com` |
| `CORS_ORIGINS` | Render | 填 `*` 即可（本应用无 Cookie 鉴权） |

## ❓ 常见问题

- **页面显示“服务未连接”？** → 前端没连上后端。检查 Vercel 的环境变量是否填对、Render 服务是否部署成功（访问 `后端地址/api/health` 应返回 `{"ok":true}`）。
- **Render 免费版第一次打开很慢？** → 正常。15 分钟无请求会休眠，唤醒约 30–60 秒。想要一直在线可换 Oracle 永久免费云。
- **iPhone 点直存没反应？** → 确认地址是 HTTPS、使用 Safari，并等按钮从“正在准备相册文件”变为“直接存入相册”。仍不行时再用 ZIP 兜底。
- **iPhone 相册没有合并成实况？** → 必须在系统面板中一次保存 JPG + MOV 两个项目；分开保存会得到一张照片和一段视频。
- **解析失败 / 提示网络错误？** → 抖音/TikTok 新版接口需要签名 Cookie，本项目默认走可配置的备用解析服务；若该服务限流，稍后重试或自建实例并配置 `PARSER_FALLBACK_*`。
- **微信里打不开页面？** → 用系统浏览器（Safari / Chrome）打开，微信内置浏览器对下载支持较差。

## 🛠 技术栈

- **前端**：Next.js 14 + TypeScript + Tailwind CSS + Radix UI + Framer Motion
- **后端**：FastAPI + FFmpeg + OpenCV（Python）
- **部署**：Vercel（前端）+ Render（后端 Docker），`render.yaml` 一键识别

## 📁 项目结构

```
livecraft/
├── app/                          # Next.js 14 App Router
│   ├── page.tsx                  # 首页
│   ├── live-photo/page.tsx       # 实况工坊（真实媒体链路 + 相册直存）
│   ├── parser/page.tsx           # 无水印解析（真实解析链路）
│   ├── inpaint/page.tsx          # 去水印橡皮擦（本地+AI 双通道）
│   ├── layout.tsx / globals.css  # 根布局 / 设计系统
├── components/
│   ├── home/                     # hero / tool-tabs / phase-strip
│   ├── layout/                   # header / footer / ambient-background
│   └── tools/                    # dropzone / range-timeline / brush-canvas /
│                                 # before-after / segmented-control /
│                                 # service-status / mobile-action-bar
├── hooks/use-media-service.ts    # 后端健康检查
├── lib/                          # livephoto.ts / media-client.ts / inpaint.ts …
├── media-service/                # FastAPI 媒体微服务
│   ├── app/routers/              # livephoto / parser / inpaint
│   ├── app/services/             # ffmpeg_plan / livephoto_mov / metadata / parser / inpaint
│   ├── Dockerfile                # 内置 FFmpeg + OpenCV
│   └── tests/smoke_test.py       # 39 项冒烟测试
├── Dockerfile                    # 前端多阶段构建
├── docker-compose.yml            # 本地一键启动
├── render.yaml                   # Render 一键部署
├── DEPLOY.md                     # 公开发布指南（中文）
└── .env.example                  # 环境变量示例
```

## 📌 开发进度

| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| 01 | 项目架构与设计系统 | ✅ 已交付 |
| 02 | 交互原型（拖拽上传 / 时间轴裁剪 / 画笔擦除） | ✅ 已交付 |
| 03 | 媒体微服务（FFmpeg 实况打包 / 解析管道 / 修复服务） | ✅ 已交付 |
| 04 | 真实链路联调（离线明确报错，不伪造结果） | ✅ 已交付 |
| 05 | 生产部署（Vercel + Render，全免费） | 🟡 进行中 |

## 💰 费用

| 项目 | 方案 | 费用 |
| ---- | ---- | ---- |
| 前端 | Vercel Hobby | 免费 |
| 后端 | Render Free | 免费 |
| 合计 | — | **0 元** |
