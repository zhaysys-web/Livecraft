# LiveCraft 公开发布指南（全免费）

架构：**Vercel**（前端，Hobby 免费版）+ **Render**（媒体服务 Docker，免费版）。
全部免费，无需绑卡。

> 顺序很重要：先部署后端（拿到公网地址），再部署前端（把后端地址填进环境变量）。

---

## 1. 把代码推到 GitHub（3 条命令）

本仓库已 `git init` 并提交，可直接推送：

```bash
cd livecraft
git remote add origin https://github.com/<你的用户名>/livecraft.git
git branch -M main
git push -u origin main
```

先在 GitHub 网页上建一个**空仓库**（不要勾选 README/license），再执行上面三条。

## 2. 部署后端 → Render（约 5 分钟）

1. 打开 https://dashboard.render.com，用 GitHub 登录
2. **New → Blueprint**，选择 `livecraft` 仓库（`render.yaml` 会被自动识别）
3. 点击 **Apply**，等待构建完成（首次约 3–5 分钟，含 FFmpeg 安装）
4. 记下服务地址，例如 `https://livecraft-media.onrender.com`
5. 浏览器打开 `https://livecraft-media.onrender.com/api/health`，
   看到 `{"ok":true,...}` 即成功

## 3. 部署前端 → Vercel（约 3 分钟）

1. 打开 https://vercel.com，用 GitHub 登录
2. **Add New → Project**，Import `livecraft` 仓库（Framework 会自动识别为 Next.js）
3. **Environment Variables** 添加一条：
   - Key：`NEXT_PUBLIC_MEDIA_SERVICE_URL`
   - Value：上一步的 Render 地址（例如 `https://livecraft-media.onrender.com`）
4. **Deploy**，得到公网地址，例如 `https://livecraft-xxx.vercel.app`

## 4. 验证

打开 Vercel 地址：
- 标题旁应显示 **「媒体服务已连接」**（而不是「演示模式」）
- 跑一遍实况转码：上传视频 → 裁剪 → 生成 → 下载 ZIP 应为真实文件

## 5. 说明与进阶

- **Render 免费版会休眠**：15 分钟无请求后休眠，下次访问唤醒约 30–60 秒。
  介意的话换 **Oracle 永久免费云**（4 核 ARM + 24G，一直在线）：开一台 VM，
  装 Docker 后 `docker compose up --build -d` 即可（compose 文件已备好）。
- **自用**：本机 `docker compose up --build`，`http://localhost:3000` 直接用，
  不花一分钱，速度还最快。
- **自定义域名**：Vercel / Render 后台均可免费绑定（需自备域名）。
- 以后更新代码：`git push` 后 Vercel 与 Render 都会自动重新部署。

## 花钱的地方（当前为 0）

| 项目 | 方案 | 费用 |
| ---- | ---- | ---- |
| 前端 | Vercel Hobby | 免费 |
| 后端 | Render Free | 免费 |
| 合计 | — | **0 元** |
