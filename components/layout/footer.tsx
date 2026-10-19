import { Aperture } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2.5 text-white/45">
          <Aperture className="h-4 w-4" />
          <span className="text-xs tracking-[0.25em]">LIVECRAFT · 灵动映像</span>
        </div>
        <p className="text-xs text-white/30">
          Creative media workstation · Crafted with Next.js & FastAPI · 2026
        </p>
      </div>
    </footer>
  );
}
