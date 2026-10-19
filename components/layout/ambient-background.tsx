"use client";

/**
 * 全局氛围背景：极光渐变光晕（缓慢漂移）+ 微网格 + 暗角
 * 纯 CSS 实现，零 JS 开销
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-ink-950"
    >
      {/* 极光光晕 */}
      <div className="absolute -top-40 left-1/2 h-[560px] w-[820px] -translate-x-1/2 animate-aurora-drift rounded-full bg-aurora-violet/25 blur-[140px]" />
      <div className="absolute -left-40 top-1/3 h-[480px] w-[480px] animate-aurora-drift rounded-full bg-aurora-cyan/15 blur-[130px] [animation-delay:-6s]" />
      <div className="absolute -right-40 bottom-0 h-[520px] w-[520px] animate-aurora-drift rounded-full bg-aurora-fuchsia/15 blur-[140px] [animation-delay:-12s]" />

      {/* 微网格（底部渐隐） */}
      <div className="mask-fade-b absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />

      {/* 暗角 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
