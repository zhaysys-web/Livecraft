"use client";

import Link from "next/link";
import { Aperture, Github, ArrowRight } from "lucide-react";

const NAV = [
  { label: "工具", href: "#tools" },
  { label: "实施蓝图", href: "#phases" },
  { label: "部署", href: "#phases" },
];

export function Header() {
  return (
    <header className="glass-strong sticky top-0 z-50 border-x-0 border-t-0">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-aurora-violet via-aurora-fuchsia to-aurora-cyan shadow-glow-violet transition-transform duration-300 group-hover:rotate-12">
            <Aperture className="h-5 w-5 text-white" strokeWidth={2.2} />
          </span>
          <span className="leading-tight">
            <span className="font-display block text-[15px] font-semibold tracking-wide">
              LiveCraft
            </span>
            <span className="block text-[11px] tracking-[0.3em] text-white/45">
              灵动映像
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-sm text-white/55 transition-colors duration-200 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-white/60 transition-all duration-200 hover:border-white/25 hover:text-white"
          >
            <Github className="h-4 w-4" />
          </a>
          <a href="#tools" className="btn-primary hidden !px-5 !py-2.5 sm:inline-flex">
            开始使用
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
