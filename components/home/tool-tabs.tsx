"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TOOLS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function ToolTabs() {
  const [active, setActive] = useState(TOOLS[0].id);
  const current = TOOLS.find((t) => t.id === active)!;

  return (
    <section id="tools" className="relative mx-auto max-w-6xl scroll-mt-24 px-5 pb-24 sm:px-8">
      <div className="mb-10 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          三件工具，各司其职
        </h2>
        <p className="mt-3 text-sm text-white/45">
          切换标签，查看每件工具的能力边界与处理管道
        </p>
      </div>

      <Tabs.Root value={active} onValueChange={setActive} className="group">
        <Tabs.List
          aria-label="工具切换"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = tool.id === active;
            return (
              <Tabs.Trigger
                key={tool.id}
                value={tool.id}
                className={cn(
                  "glass group flex items-center gap-4 rounded-2xl p-5 text-left transition-all duration-300",
                  "hover:border-white/25 hover:bg-white/[0.06]",
                  "data-[state=active]:border-aurora-violet/40 data-[state=active]:bg-white/[0.07]",
                  tool.glow,
                )}
              >
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-all duration-300",
                    isActive
                      ? "bg-gradient-to-br from-aurora-violet to-aurora-cyan text-white"
                      : "bg-white/[0.06] text-white/60",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-white">
                    {tool.name}
                  </span>
                  <span className="block text-xs text-white/40">{tool.en}</span>
                </span>
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>

        <div className="mt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <Tabs.Content value={current.id} forceMount>
                <div className="glass shadow-card rounded-3xl p-8 sm:p-10">
                  <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
                    <div className="max-w-xl">
                      <h3 className="font-display text-2xl font-bold">
                        {current.tagline}
                      </h3>
                      <p className="mt-4 text-sm leading-relaxed text-white/55">
                        {current.description}
                      </p>
                      <ul className="mt-6 space-y-2.5">
                        {current.features.map((f) => (
                          <li
                            key={f}
                            className="flex items-start gap-2.5 text-sm text-white/70"
                          >
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-aurora-violet/20">
                              <Check className="h-3 w-3 text-aurora-violet" />
                            </span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Link
                      href={current.href}
                      className="btn-primary shrink-0"
                    >
                      进入{current.name}
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </Tabs.Content>
            </motion.div>
          </AnimatePresence>
        </div>
      </Tabs.Root>
    </section>
  );
}
