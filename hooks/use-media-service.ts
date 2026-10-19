"use client";

import { useEffect, useState } from "react";
import { mediaHealth } from "@/lib/media-client";

export type ServiceStatus = "checking" | "online" | "offline";

/**
 * 检测 media-service 是否可达（适配 Render 免费版冷启动）。
 * - 每次探测带超时，失败按退避间隔重试（冷启动约 30–60 秒）
 * - 判定 offline 后继续低频轮询，服务恢复时自动翻为 online
 */
const HEALTH_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [2000, 5000, 12000];
const POLL_INTERVAL_MS = 60000;

export function useMediaService(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>("checking");

  useEffect(() => {
    let alive = true;
    let pollTimer: number | undefined;

    const probe = async (): Promise<boolean> => {
      try {
        await mediaHealth(HEALTH_TIMEOUT_MS);
        return true;
      } catch {
        return false;
      }
    };

    const run = async () => {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (!alive) return;
        if (attempt > 0) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAYS_MS[attempt - 1]),
          );
          if (!alive) return;
        }
        if (await probe()) {
          if (alive) setStatus("online");
          return;
        }
      }
      if (alive) setStatus("offline");
      // 离线后继续轮询：后端从休眠唤醒时自动恢复 online
      pollTimer = window.setInterval(async () => {
        if (!alive) return;
        if (await probe()) {
          if (alive) {
            setStatus("online");
            if (pollTimer !== undefined) window.clearInterval(pollTimer);
          }
        }
      }, POLL_INTERVAL_MS);
    };

    void run();
    return () => {
      alive = false;
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
    };
  }, []);

  return status;
}
