"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SegmentOption<T> {
  value: T;
  label: string;
  sub?: string;
}

/**
 * 单选分段控制器（Segmented Control）
 * 选中项带滑动指示器，支持副标题
 */
export function SegmentedControl<T extends string | number>({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="glass rounded-2xl p-1.5"
      role="radiogroup"
      aria-label="时长模式"
    >
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))`,
        }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative rounded-xl px-3 py-3 text-center transition-colors duration-200",
                !active && "hover:bg-white/[0.04]",
              )}
            >
              {active && (
                <motion.span
                  layoutId={`seg-${id}`}
                  className="absolute inset-0 rounded-xl border border-aurora-violet/45 bg-gradient-to-br from-aurora-violet/25 to-aurora-cyan/15 shadow-glow-violet"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span
                className={cn(
                  "relative block text-sm font-semibold",
                  active ? "text-white" : "text-white/55",
                )}
              >
                {o.label}
              </span>
              {o.sub && (
                <span className="relative mt-1 block text-[11px] leading-snug text-white/40">
                  {o.sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
