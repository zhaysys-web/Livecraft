/**
 * media-service 客户端（阶段三联调用）。
 * 服务地址走环境变量 NEXT_PUBLIC_MEDIA_SERVICE_URL，默认 http://localhost:8000。
 * 前端三个工具页在阶段四把现在的"原型演示"分支换成这里的真实调用即可。
 */

const BASE =
  process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL ?? "http://localhost:8000";

export interface LivePhotoParams {
  durationMode: 3 | 5;
  clipStart: number;
  keyframeTime: number;
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
    export_duration: number;
    still_image_time: number;
    clip_start: number;
    keyframe_time: number;
    needs_fallback: boolean;
    fallback: string;
    metadata_notes: string[];
  };
}

export interface ParseResult {
  platform: string;
  video_url: string;
  title: string;
  author: string;
  cover_url: string;
  strategy: string;
  warnings: string[];
}

function abs(url: string): string {
  return url.startsWith("http") ? url : `${BASE}${url}`;
}

export async function livePhotoConvert(
  video: File,
  p: LivePhotoParams,
): Promise<LivePhotoResult> {
  const fd = new FormData();
  fd.append("video", video);
  fd.append("duration_mode", String(p.durationMode));
  fd.append("clip_start", String(p.clipStart));
  fd.append("keyframe_time", String(p.keyframeTime));
  fd.append("fallback", p.fallback);
  fd.append("codec", p.codec);
  fd.append("muted", String(p.muted));
  fd.append("audio_fade_secs", String(p.audioFadeSecs ?? 0.2));
  if (p.contentIdentifier) fd.append("content_identifier", p.contentIdentifier);
  const res = await fetch(`${BASE}/api/live-photo`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`转码失败（${res.status}）：${await res.text()}`);
  const body = (await res.json()) as LivePhotoResult;
  body.still_url = abs(body.still_url);
  body.mov_url = abs(body.mov_url);
  body.download_url = abs(body.download_url);
  return body;
}

export async function parseShareLink(shareText: string): Promise<ParseResult> {
  const res = await fetch(`${BASE}/api/parser`, {
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
  const res = await fetch(`${BASE}/api/inpaint`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`修复失败（${res.status}）：${await res.text()}`);
  return res.blob();
}

export async function mediaHealth(): Promise<{ ok: boolean; ffmpeg: string }> {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error("media-service 不可用");
  return res.json();
}
