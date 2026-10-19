"use client";

import { motion } from "framer-motion";
import { ArrowRight, Layers } from "lucide-react";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const CHIPS = ["FFmpeg 媒体管道", "Canvas 画笔", "iOS 实况元数据"];

export function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl px-5 pb-20 pt-24 text-center sm:px-8 sm:pt-32">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="flex flex-col items-center"
      >
        <motion.div variants={item}>
          <span className="eyebrow">
            <Layers className="h-3.5 w-3.5 text-aurora-violet" />
            CREATIVE MEDIA TOOLKIT
          </span>
        </motion.div>

        <motion.h1
          variants={item}
          className="font-display mt-8 text-5xl font-bold leading-[1.08] tracking-tight sm:text-7xl"
        >
          灵动映像
          <span className="text-gradient block pb-2">LiveCraft</span>
        </motion.h1>

        <motion.p
          variants={item}
          className="mt-6 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg"
        >
          视频转 Apple 实况照片 · 短视频无水印解析 · 图片去水印擦除
          <br className="hidden sm:block" />
          三件工具，一个深色工作台。
        </motion.p>

        <motion.div
          variants={item}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
        >
          <a href="#tools" className="btn-primary">
            开始使用
            <ArrowRight className="h-4 w-4" />
          </a>
          <a href="#phases" className="btn-ghost">
            查看实施蓝图
          </a>
        </motion.div>

        <motion.div
          variants={item}
          className="mt-10 flex flex-wrap items-center justify-center gap-2.5"
        >
          {CHIPS.map((chip) => (
            <span key={chip} className="chip">
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-gradient-to-r from-aurora-violet to-aurora-cyan" />
              {chip}
            </span>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
