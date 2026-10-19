"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { PHASES } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function PhaseStrip() {
  return (
    <section
      id="phases"
      className="relative mx-auto max-w-6xl scroll-mt-24 px-5 pb-28 sm:px-8"
    >
      <div className="mb-10 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          实施蓝图
        </h2>
        <p className="mt-3 text-sm text-white/45">
          五个阶段，从设计系统到生产部署
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PHASES.map((phase, i) => (
          <motion.div
            key={phase.no}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.08 }}
            className={cn(
              "glass rounded-2xl p-5 transition-colors duration-300",
              phase.status === "doing" && "border-aurora-violet/40",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-semibold tracking-[0.25em] text-white/35">
                {phase.no}
              </span>
              {phase.status === "doing" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-aurora-violet/15 px-2.5 py-1 text-[11px] font-medium text-aurora-violet">
                  <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-aurora-violet" />
                  进行中
                </span>
              ) : phase.status === "done" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                  <Check className="h-3 w-3" />
                  已完成
                </span>
              ) : (
                <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/35">
                  待启动
                </span>
              )}
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-white">
              {phase.name}
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-white/40">
              {phase.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
