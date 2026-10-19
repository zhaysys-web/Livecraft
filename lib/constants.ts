import {
  Clapperboard,
  Link2,
  Eraser,
  type LucideIcon,
} from "lucide-react";

export interface ToolMeta {
  id: string;
  name: string;
  en: string;
  tagline: string;
  description: string;
  features: string[];
  href: string;
  icon: LucideIcon;
  /** 激活态光晕颜色（tailwind arbitrary value 片段） */
  glow: string;
}

export const TOOLS: ToolMeta[] = [
  {
    id: "live-photo",
    name: "实况工坊",
    en: "Live Photo Studio",
    tagline: "把任意视频变成 iPhone 相册里的实况照片",
    description:
      "上传视频，拖动时间轴拾取封面帧，后端经 FFmpeg 重封装为 H.264/HEVC 标准 Live Photo（≤3s），注入 Apple ContentIdentifier 元数据，一键打包下载。",
    features: [
      "封面帧时间轴拾取 / 自由上传封面图",
      "H.264 / HEVC 双格式重封装",
      "ContentIdentifier 元数据自动注入",
      "静音 / 原音切换，一键 ZIP 打包",
    ],
    href: "/live-photo",
    icon: Clapperboard,
    glow: "group-data-[state=active]:shadow-glow-violet",
  },
  {
    id: "parser",
    name: "无水印解析",
    en: "Watermark-free Parser",
    tagline: "粘贴分享链接，拿回干净的原画质视频",
    description:
      "支持抖音、快手、小红书、TikTok 等主流平台。多重容错解析管道：Headless 抓取 → 正则 API 提取 → 第三方引擎回退，实时预览一键下载。",
    features: [
      "抖音 / 快手 / 小红书 / TikTok 分享链接",
      "Headless + 正则 + 第三方三级容错管道",
      "UA 伪装与防封禁机制",
      "原画质实时预览，一键下载",
    ],
    href: "/parser",
    icon: Link2,
    glow: "group-data-[state=active]:shadow-glow-cyan",
  },
  {
    id: "inpaint",
    name: "去水印橡皮擦",
    en: "Inpaint Eraser",
    tagline: "笔刷一抹，水印消失",
    description:
      "Canvas 画笔涂抹水印区域，轻量场景走前端 OpenCV/纹理修补，高精度场景对接 LaMa / SD Inpainting。撤销重做、Before-After 对比滑块一应俱全。",
    features: [
      "画笔粗细调节 / 橡皮擦 / 撤销重做",
      "Before-After 对比滑块",
      "前端轻量修补 + AI 高精度修复双通道",
      "本地 ONNX 模型可选部署",
    ],
    href: "/inpaint",
    icon: Eraser,
    glow: "group-data-[state=active]:shadow-glow-violet",
  },
];

export const PHASES = [
  { no: "01", name: "设计系统", desc: "工程初始化 · Tokens · 布局骨架", status: "done" },
  { no: "02", name: "交互原型", desc: "Dropzone · 时间轴拾取器 · Canvas 画笔", status: "doing" },
  { no: "03", name: "媒体管道", desc: "Live Photo 封装 · 解析管道 · 修复服务", status: "todo" },
  { no: "04", name: "健壮性测试", desc: "超时/大文件/异常链接 · Toast 降级", status: "todo" },
  { no: "05", name: "生产部署", desc: "Docker · Vercel · Nginx HTTPS", status: "todo" },
] as const;
