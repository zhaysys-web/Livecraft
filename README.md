# LiveCraft / 灵动映像

高美感多媒体处理工作台：**视频转 Apple Live Photo**、**短视频无水印解析**、**图片去水印擦除**，
三件工具，一个深色沉浸式界面。

## ✨ 三个工具

| 工具 | 能做什么 |
| ---- | -------- |
| **实况工坊** | 视频转 iPhone 实况照片。3 秒 / 5 秒两种时长模式，封面帧任意选，太短的视频自动正倒放补足或慢放拉伸 |
| **无水印解析** | 粘贴抖音 / 快手 / 小红书 / TikTok 分享口令，解析出无水印视频直链，一键复制 |
| **去水印橡皮擦** | 画笔涂抹水印区域，本地快速擦除与 AI 高精度修复双通道，支持撤销重做、Before-After 对比 |

后端没启动时前端自动进入演示模式，界面照常用，转码类操作会提示连接服务。

## 🚀 在线体验

部署完成后地址填这里：

- 前端：`https://<your-app>.vercel.app`

## 💻 本地运行

### 只看界面（演示模式）

```bash
npm install
npm run dev        # http://localhost:3000
```

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

- **页面显示"演示模式"？** → 前端没连上后端。检查 Vercel 的环境变量是否填对、Render 服务是否部署成功（访问 `后端地址/api/health` 应返回 `{"ok":true}`）。
- **Render 免费版第一次打开很慢？** → 正常。15 分钟无请求会休眠，唤醒约 30–60 秒。想要一直在线可换 Oracle 永久免费云。
- **iPhone 相册不识别实况？** → 用 Safari 打开页面再下载；确认下载的是 ZIP 解压后的 JPG+MOV 配对文件。
- **解析失败 / 提示网络错误？** → 短视频平台反爬较严，换一条链接或稍后重试；受限网络环境也可能调不通平台接口。
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
│   ├── live-photo/page.tsx       # 实况工坊（真实转码链路）
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
│   ├── app/services/             # ffmpeg_plan / metadata / parser / inpaint
│   ├── Dockerfile                # 内置 FFmpeg + OpenCV
│   └── tests/smoke_test.py       # 27 项冒烟测试
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
| 04 | 真实链路联调（服务离线自动降级演示模式） | ✅ 已交付 |
| 05 | 生产部署（Vercel + Render，全免费） | 🟡 进行中 |

## 💰 费用

| 项目 | 方案 | 费用 |
| ---- | ---- | ---- |
| 前端 | Vercel Hobby | 免费 |
| 后端 | Render Free | 免费 |
| 合计 | — | **0 元** |
