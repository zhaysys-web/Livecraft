/** Shared UI models and helpers for the Live Photo workspace. */

export type DurationMode = 3 | 5;
export type FallbackStrategy = "pingpong" | "slowdown" | "keep";
export type VideoCodec = "h264" | "hevc";

export const DURATION_MODES: {
  value: DurationMode;
  label: string;
  sub: string;
}[] = [
  { value: 3, label: "3 秒", sub: "推荐 · 原生锁屏 / 全平台最佳兼容" },
  { value: 5, label: "5 秒", sub: "适合相册展示 / 小红书等社交平台" },
];

export const FALLBACKS: {
  value: FallbackStrategy;
  label: string;
  en: string;
  desc: string;
}[] = [
  {
    value: "pingpong",
    label: "正倒放循环",
    en: "Ping-Pong",
    desc: "正放 + 倒放拼接补齐至目标时长，动作连贯不断",
  },
  {
    value: "slowdown",
    label: "变速慢放",
    en: "Slow-down",
    desc: "平滑降速拉伸至目标时长",
  },
  {
    value: "keep",
    label: "保持原长",
    en: "Keep",
    desc: "不强制拉伸，按原视频最大时长导出",
  },
];

export const FALLBACK_LABEL: Record<FallbackStrategy, string> = {
  pingpong: "正倒放循环",
  slowdown: "变速慢放",
  keep: "保持原长",
};

export function needsFallback(
  videoDuration: number,
  mode: DurationMode,
): boolean {
  return videoDuration > 0 && videoDuration < mode;
}

/** Fixed crop window width, capped by the source duration. */
export function effectiveWindow(
  videoDuration: number,
  mode: DurationMode,
): number {
  if (videoDuration <= 0) return mode;
  return Math.min(mode, videoDuration);
}

export function newContentIdentifier(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().toUpperCase();
  }
  // crypto.randomUUID 只在安全上下文可用；局域网 HTTP 下仍要能生成 UUID。
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ]
    .join("-")
    .toUpperCase();
}

/** m:ss.s */
export function formatClock(t: number): string {
  if (!isFinite(t) || t < 0) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}
