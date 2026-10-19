"use client";

import { useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

/**
 * Before / After 对比滑块：拖拽中线查看处理前后
 */
export function BeforeAfter({
  before,
  after,
  beforeLabel = "处理前",
  afterLabel = "处理后",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, pct)));
  };

  return (
    <div
      ref={ref}
      className="relative select-none overflow-hidden rounded-2xl border border-white/10 shadow-card"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        update(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && update(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* 底层：处理后 */}
      <img src={after} alt={afterLabel} draggable={false} className="block w-full" />

      {/* 顶层：处理前（按滑块裁剪） */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img
          src={before}
          alt={beforeLabel}
          draggable={false}
          className="h-full w-full object-cover"
        />
      </div>

      {/* 分割线 + 手柄 */}
      <div
        className="absolute inset-y-0 w-px bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.6)]"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-black/60 backdrop-blur-xl">
          <ChevronsLeftRight className="h-5 w-5 text-white" />
        </span>
      </div>

      <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white/85 backdrop-blur-xl">
        {beforeLabel}
      </span>
      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white/85 backdrop-blur-xl">
        {afterLabel}
      </span>
    </div>
  );
}
