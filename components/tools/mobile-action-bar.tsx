"use client";

import { cn } from "@/lib/utils";

export interface BarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}

/**
 * 移动端底部悬浮操作栏（桌面端隐藏）
 * 注意：使用它的页面底部需预留 pb-28 md:pb-* 间距
 */
export function MobileActionBar({ actions }: { actions: BarAction[] }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl md:hidden">
      <div className="flex gap-3">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            disabled={a.disabled}
            className={cn(
              "flex-1 rounded-full py-3 text-sm font-semibold transition-all duration-200 active:scale-[0.98]",
              a.primary
                ? "bg-white text-black shadow-glow-violet disabled:opacity-35 disabled:shadow-none"
                : "border border-white/15 text-white/80 disabled:opacity-35",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
