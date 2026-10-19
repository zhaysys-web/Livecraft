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
      "上传视频，一键生成 Apple 实况照片：后端用 FFmpeg 探测参数，兼容视频走流复制不重编码，JPG 与 MOV 写入严格匹配的 ContentIdentifier；结果页可直接存入 iPhone 相册，ZIP 兜底。",
    features: [
      "3 秒 / 5 秒时长模式，定长滑窗裁剪",
      "区间内拖动选择实况封面帧",
      "兼容视频流复制，画质无损",
      "JPG / MOV 元数据严格配对校验",
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
      "支持抖音、快手、小红书、TikTok 分享口令。多级解析管道：页面 JSON → 正则提取 → 第三方备用，解析出无水印直链并经签名代理播放下载。",
    features: [
      "抖音 / 快手 / 小红书 / TikTok 分享链接",
      "页面解析 + 正则提取 + 第三方备用",
      "移动端 / 桌面端 UA 适配",
      "签名代理直链，支持断点续传",
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
      "Canvas 画笔涂抹水印区域：小面积走前端轻量填充，大面积走后端 OpenCV（TELEA / NS）高精度修复。撤销重做、Before-After 对比滑块一应俱全。",
    features: [
      "画笔粗细调节 / 橡皮擦 / 撤销重做",
      "Before-After 对比滑块",
      "前端轻量填充 + 后端高精度双通道",
      "掩膜精确到像素",
    ],
    href: "/inpaint",
    icon: Eraser,
    glow: "group-data-[state=active]:shadow-glow-violet",
  },
];

type PhaseStatus = "done" | "doing" | "todo";

export const PHASES: { no: string; name: string; desc: string; status: PhaseStatus }[] = [
  { no: "01", name: "设计系统", desc: "工程初始化 · Tokens · 布局骨架", status: "done" },
  { no: "02", name: "交互原型", desc: "Dropzone · 时间轴拾取器 · Canvas 画笔", status: "done" },
  { no: "03", name: "媒体管道", desc: "Live Photo 封装 · 解析管道 · 修复服务", status: "done" },
  { no: "04", name: "健壮性测试", desc: "超时/大文件/异常链接 · Toast 降级", status: "done" },
  { no: "05", name: "生产部署", desc: "Vercel 前端 · Render 后端 · 全免费上线", status: "done" },
];
