"use client";

import { useMediaService } from "@/hooks/use-media-service";
import { cn } from "@/lib/utils";

/**
 * 媒体服务连接状态 pill，放在各工具页标题旁。
 */
export function ServiceStatusPill() {
  const status = useMediaService();

  return (
    <span
      title={
        status === "online"
          ? "media-service 已连接，将调用真实处理管道"
          : status === "checking"
            ? "正在检测媒体服务…"
            : "媒体服务未连接，当前为原型演示模式"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium",
        status === "online" &&
          "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        status === "checking" &&
          "border-amber-300/30 bg-amber-300/10 text-amber-200",
        status === "offline" && "border-white/10 bg-white/[0.04] text-white/45",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "online" && "bg-emerald-400",
          status === "checking" && "animate-pulse bg-amber-300",
          status === "offline" && "bg-white/30",
        )}
      />
      {status === "online"
        ? "媒体服务已连接"
        : status === "checking"
          ? "检测服务中…"
          : "演示模式"}
    </span>
  );
}
