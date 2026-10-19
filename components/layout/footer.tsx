import Link from "next/link";
import { Aperture, Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
        <div className="flex items-center gap-2.5 text-white/45">
          <Aperture className="h-4 w-4" />
          <span className="text-xs tracking-[0.25em]">LIVECRAFT · 灵动映像</span>
        </div>
        <nav className="flex items-center gap-5 text-xs text-white/40">
          <Link href="/privacy" className="transition-colors hover:text-white">
            隐私政策
          </Link>
          <Link href="/terms" className="transition-colors hover:text-white">
            使用条款
          </Link>
          <a
            href="https://github.com/zhaysys-web/Livecraft"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
        </nav>
        <p className="text-xs text-white/30">
          Creative media workstation · Crafted with Next.js & FastAPI · 2026
        </p>
      </div>
    </footer>
  );
}
