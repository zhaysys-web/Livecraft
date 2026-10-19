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

/**
 * 带上传进度的 POST（fetch 不支持上传进度，这里用 XHR）。
 * 返回与 fetch Response 兼容的最小接口（ok/status/json/text）。
 */
function xhrPost(
  url: string,
  body: FormData,
  onProgress: (loaded: number, total: number) => void,
  timeoutMs: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    xhr.responseType = "text";
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      const headers = new Headers();
      xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .forEach((line) => {
          const idx = line.indexOf(":");
          if (idx > 0)
            headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
        });
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
        }),
      );
    };
    xhr.onerror = () => reject(new Error("网络请求失败，请检查网络后重试"));
    xhr.ontimeout = () =>
      reject(new Error("请求超时（10 分钟），请试试更短的视频或稍后重试"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    xhr.send(body);
  });
}

/**
 * 带超时的 fetch。超时后抛出中文错误（Render 冷启动场景下提示用户稍后重试）。
 * 注意：转码请求走同步后端，超时必须远大于单次转码耗时。
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        `请求超时（${Math.round(timeoutMs / 1000)} 秒），媒体服务可能正在冷启动，请稍后重试`,
      );
    }
    throw e instanceof Error ? e : new Error("网络请求失败，请检查网络后重试");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function livePhotoConvert(
  video: File,
  p: LivePhotoParams,
  onUploadProgress?: (percent: number, loaded: number, total: number) => void,
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

  return new Promise<LivePhotoResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${mediaBase()}/api/live-photo`;
    xhr.open("POST", url);
    xhr.timeout = 600000;

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onUploadProgress(percent, event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as LivePhotoResult;
          body.still_url = abs(body.still_url);
          body.mov_url = abs(body.mov_url);
          body.download_url = abs(body.download_url);
          resolve(body);
        } catch {
          reject(new Error("解析服务端返回数据失败"));
        }
      } else {
        let detail = xhr.responseText;
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: string; message?: string };
          detail = body.detail ?? body.message ?? xhr.responseText;
        } catch {
          // Keep raw
        }
        reject(new Error(`生成失败（${xhr.status}）：${detail}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("网络请求失败，请检查网络连接或后端媒体服务"));
    };

    xhr.ontimeout = () => {
      reject(new Error("请求超时（600 秒），媒体服务处理超时或正在冷启动"));
    };

    xhr.send(fd);
  });
}

export async function deleteLivePhotoJob(jobId: string): Promise<void> {
  await fetchWithTimeout(
    `${mediaBase()}/api/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE", keepalive: true },
    10000,
  );
}

export async function parseShareLink(shareText: string): Promise<ParseResult> {
  const res = await fetchWithTimeout(
    `${mediaBase()}/api/parser`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_text: shareText }),
    },
    60000,
  );
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
  const res = await fetchWithTimeout(
    `${mediaBase()}/api/inpaint`,
    { method: "POST", body: fd },
    120000,
  );
  if (!res.ok) throw new Error(`修复失败（${res.status}）：${await res.text()}`);
  return res.blob();
}

export async function mediaHealth(
  timeoutMs = 8000,
): Promise<{ ok: boolean; ffmpeg: string }> {
  const res = await fetchWithTimeout(`${mediaBase()}/api/health`, {}, timeoutMs);
  if (!res.ok) throw new Error("media-service 不可用");
  return res.json();
}
