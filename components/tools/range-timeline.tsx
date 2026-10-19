"use client";

import { useRef } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/livephoto";

interface RangeTimelineProps {
  /** 视频总时长（秒） */
  duration: number;
  /** 定长窗口（秒）：3 或 5；超过总时长时按全量处理 */
  windowSecs: number;
  /** 窗口起始（秒，受控） */
  start: number;
  /** 封面帧时间戳（秒，受控，约束在窗口内） */
  keyframe: number;
  onStartChange: (s: number) => void;
  onKeyframeChange: (t: number) => void;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * 定长滑动裁剪时间轴：
 * - 窗口宽度锁定为 windowSecs，可左右拖动（点击轨道空白处快速定位）
 * - 琥珀色游标在窗口内拖动，指定实况封面帧（still-image-time）
 */
export function RangeTimeline({
  duration,
  windowSecs,
  start,
  keyframe,
  onStartChange,
  onKeyframeChange,
}: RangeTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const winDrag = useRef<{ grabOffset: number } | null>(null);
  const kfDrag = useRef(false);

  const ready = duration > 0;
  const win = ready ? Math.min(windowSecs, duration) : windowSecs;
  const draggable = ready && windowSecs < duration;
  const maxStart = Math.max(0, duration - win);

  const toStart = (clientX: number, grabOffset: number) => {
    const track = trackRef.current!.getBoundingClientRect();
    const x = clientX - track.left - grabOffset;
    return clamp(
      Math.round((x / track.width) * duration * 100) / 100,
      0,
      maxStart,
    );
  };

  /** 点击轨道空白处：窗口中心跳到点击位置 */
  const jumpTo = (clientX: number) => {
    const track = trackRef.current!.getBoundingClientRect();
    const winPx = (win / duration) * track.width;
    onStartChange(toStart(clientX, winPx / 2));
  };

  const ticks = ready
    ? Array.from({ length: 6 }, (_, i) => (duration * i) / 5)
    : [];

  return (
    <div>
      <div
        ref={trackRef}
        className={cn(
          "relative h-20 select-none overflow-hidden rounded-2xl border border-white/10 bg-black/50",
          !ready && "opacity-50",
        )}
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          if (draggable) jumpTo(e.clientX);
        }}
      >
        {/* 条纹底纹 */}
        <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.05)_0_1px,transparent_1px_14px)]" />

        {/* 刻度 */}
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute inset-y-0"
            style={{ left: `${(t / duration) * 100}%` }}
          >
            <div className="h-2.5 w-px bg-white/25" />
            <span className="absolute left-1 top-3 font-mono text-[10px] text-white/40">
              {formatClock(t)}
            </span>
          </div>
        ))}

        {/* 定长裁剪窗口 */}
        {ready && (
          <div
            className={cn(
              "absolute inset-y-2 rounded-xl border-2 bg-gradient-to-b from-aurora-violet/25 to-aurora-cyan/15",
              draggable
                ? "cursor-grab border-aurora-violet/70 active:cursor-grabbing"
                : "border-white/20",
            )}
            style={{
              left: `${(start / duration) * 100}%`,
              width: `${(win / duration) * 100}%`,
            }}
            onPointerDown={(e) => {
              if (!draggable) return;
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const rect = (
                e.currentTarget as HTMLElement
              ).getBoundingClientRect();
              winDrag.current = { grabOffset: e.clientX - rect.left };
            }}
            onPointerMove={(e) => {
              if (!winDrag.current) return;
              onStartChange(toStart(e.clientX, winDrag.current.grabOffset));
            }}
            onPointerUp={() => (winDrag.current = null)}
            onPointerCancel={() => (winDrag.current = null)}
          >
            <GripVertical className="absolute left-1 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <GripVertical className="absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur">
              {win.toFixed(1)}s
            </span>
          </div>
        )}

        {/* 封面帧游标 */}
        {ready && (
          <div
            className="absolute inset-y-0 z-10"
            style={{ left: `${(keyframe / duration) * 100}%` }}
          >
            <div className="absolute inset-y-0 -left-px w-0.5 bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.8)]" />
            <button
              aria-label="拖动选择封面帧"
              className="absolute -left-4 top-1/2 grid h-8 w-8 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-amber-300/60 bg-black/70 backdrop-blur transition-transform hover:scale-110"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                kfDrag.current = true;
              }}
              onPointerMove={(e) => {
                if (!kfDrag.current) return;
                const track = trackRef.current!.getBoundingClientRect();
                const t = ((e.clientX - track.left) / track.width) * duration;
                onKeyframeChange(
                  clamp(Math.round(t * 100) / 100, start, start + win),
                );
              }}
              onPointerUp={() => (kfDrag.current = false)}
              onPointerCancel={() => (kfDrag.current = false)}
            >
              <span className="h-2 w-2 rotate-45 bg-amber-300" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-white/35">
        <span>
          {draggable
            ? `拖动窗口选择 ${win.toFixed(1)}s 片段 · 点击轨道可快速定位`
            : "已覆盖全部视频时长"}
        </span>
        <span className="font-mono">总时长 {formatClock(duration)}</span>
      </div>
    </div>
  );
}
