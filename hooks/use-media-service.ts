"use client";

import { useEffect, useState } from "react";
import { mediaHealth } from "@/lib/media-client";

export type ServiceStatus = "checking" | "online" | "offline";

/**
 * 检测 media-service 是否可达。
 * online → 工具页走真实管道；offline → 仅提示连接失败，不伪造处理结果。
 */
export function useMediaService(): ServiceStatus {
  const [status, setStatus] = useState<ServiceStatus>("checking");

  useEffect(() => {
    let alive = true;
    mediaHealth()
      .then(() => {
        if (alive) setStatus("online");
      })
      .catch(() => {
        if (alive) setStatus("offline");
      });
    return () => {
      alive = false;
    };
  }, []);

  return status;
}
