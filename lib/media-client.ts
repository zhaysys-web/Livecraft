/**
 * media-service 客户端（阶段三联调用）。
 * 服务地址走环境变量 NEXT_PUBLIC_MEDIA_SERVICE_URL，默认 http://localhost:8000。
 * 三个工具页都调用这里的真实接口；失败时向用户明确报错，不伪造结果。
 */

/**
 * 未配置环境变量时，桌面端回落 localhost；手机通过局域网 IP 打开页面时，
 * 自动改用同一主机名的 8000 端口，避免请求到手机自己的 localhost。
 */
function mediaBase(): string {
  const configured = (process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return `${protocol}//${hostname}:8000`;
    }
  }
  return "http://localhost:8000";
}

export interface LivePhotoParams {
  durationMode: 3 | 5;
  clipStart: number;
  /** 封面帧时间戳（秒）；传 null 时后端自动取片段中点 */
  keyframeTime: number | null;
  fallback: "pingpong" | "slowdown" | "keep";
  codec: "h264" | "hevc";
  muted: boolean;
  audioFadeSecs?: number;
  contentIdentifier?: string;
}

export interface LivePhotoResult {
  job_id: string;
  still_url: string;
  mov_url: string;
  download_url: string;
  meta: {
    content_identifier: string;
    file_base_name: string;
    export_duration: number;
    output_duration: number;
    still_image_time: number;
    keyframe_offset: number;
    clip_start: number;
    keyframe_time: number;
    needs_fallback: boolean;
    fallback: string;
    video_action: "copy" | "reencode";
    audio_action: "copy" | "reencode" | "none";
    no_reencode: boolean;
    source_video_codec: string;
    source_pix_fmt: string;
    metadata_notes: string[];
    warnings: string[];
  };
}

export interface ParseResult {
  platform: string;
  video_url: string;
  download_url: string;
  title: string;
  author: string;
  cover_url: string;
  strategy: string;
  warnings: string[];
}

function abs(url: string): string {
  return url.startsWith("http") ? url : `${mediaBase()}${url}`;
}

export async function livePhotoConvert(
  video: File,
  p: LivePhotoParams,
): Promise<LivePhotoResult> {
  const fd = new FormData();
  fd.append("video", video);
  fd.append("duration_mode", String(p.durationMode));
  fd.append("clip_start", String(p.clipStart));
  fd.append("keyframe_time", p.keyframeTime == null ? "" : String(p.keyframeTime));
  fd.append("fallback", p.fallback);
  fd.append("codec", p.codec);
  fd.append("muted", String(p.muted));
  fd.append("audio_fade_secs", String(p.audioFadeSecs ?? 0.2));
  if (p.contentIdentifier) fd.append("content_identifier", p.contentIdentifier);
  const res = await fetch(`${mediaBase()}/api/live-photo`, { method: "POST", body: fd });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const body = JSON.parse(text) as { detail?: string; message?: string };
      detail = body.detail ?? body.message ?? text;
    } catch {
      // Keep the raw response when the server did not return JSON.
    }
    throw new Error(`生成失败（${res.status}）：${detail}`);
  }
  const body = (await res.json()) as LivePhotoResult;
  body.still_url = abs(body.still_url);
  body.mov_url = abs(body.mov_url);
  body.download_url = abs(body.download_url);
  return body;
}

export async function deleteLivePhotoJob(jobId: string): Promise<void> {
  await fetch(`${mediaBase()}/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    keepalive: true,
  });
}

export async function parseShareLink(shareText: string): Promise<ParseResult> {
  const res = await fetch(`${mediaBase()}/api/parser`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ share_text: shareText }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? `解析失败（${res.status}）`);
  return body as ParseResult;
}

export async function inpaintImage(
  image: File,
  mask: File,
  method: "telea" | "ns" = "telea",
): Promise<Blob> {
  const fd = new FormData();
  fd.append("image", image);
  fd.append("mask", mask);
  fd.append("method", method);
  const res = await fetch(`${mediaBase()}/api/inpaint`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`修复失败（${res.status}）：${await res.text()}`);
  return res.blob();
}

export async function mediaHealth(): Promise<{ ok: boolean; ffmpeg: string }> {
  const res = await fetch(`${mediaBase()}/api/health`);
  if (!res.ok) throw new Error("media-service 不可用");
  return res.json();
}
