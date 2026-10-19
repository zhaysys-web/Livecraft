"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Play,
  RotateCcw,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  MobileActionBar,
  type BarAction,
} from "@/components/tools/mobile-action-bar";
import { ServiceStatusPill } from "@/components/tools/service-status";
import { useMediaService } from "@/hooks/use-media-service";
import { parseShareLink, type ParseResult } from "@/lib/media-client";
import { cn } from "@/lib/utils";

const PLATFORMS = ["自动识别", "抖音", "快手", "小红书", "TikTok"];

/** 离线演示的分阶段文案 */
const STAGES = [
  "正在解析分享链接…",
  "正在提取无水印直链…",
  "正在获取视频信息…",
];

type Status = "idle" | "working" | "done";

export default function ParserPage() {
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [status, setStatus] = useState<Status>("idle");
  const [stageIdx, setStageIdx] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 真实解析结果
  const [realResult, setRealResult] = useState<ParseResult | null>(null);
  const jobRunning = useRef(false);

  const serviceStatus = useMediaService();
  const online = serviceStatus === "online";

  const runRealParse = async (text: string) => {
    if (jobRunning.current) return;
    jobRunning.current = true;
    try {
      const r = await parseShareLink(text);
      setRealResult(r);
      setHint(null);
      setStatus("done");
    } catch (e) {
      setRealResult(null);
      setHint(e instanceof Error ? e.message : "解析失败，请重试");
      setStatus("idle");
    } finally {
      jobRunning.current = false;
    }
  };

  const parse = () => {
    if (!url.trim()) {
      setHint("请先粘贴一条短视频分享链接");
      return;
    }
    setHint(null);
    setRealResult(null);
    setStageIdx(0);
    setStatus("working");
    if (online) {
      runRealParse(url.trim());
    }
    // 离线 → 由下方 effect 驱动演示进度
  };

  const reset = () => {
    setUrl("");
    setStatus("idle");
    setStageIdx(0);
    setHint(null);
    setRealResult(null);
    setCopied(false);
  };

  // 离线演示：模拟进度
  useEffect(() => {
    if (status !== "working" || online) return;
    if (stageIdx >= STAGES.length) {
      const t = window.setTimeout(() => setStatus("done"), 500);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setStageIdx((i) => i + 1), 900);
    return () => window.clearTimeout(t);
  }, [status, stageIdx, online]);

  const progress = Math.min(100, ((stageIdx + 1) / STAGES.length) * 100);

  const copyLink = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setHint("复制失败，请手动长按复制");
    }
  };

  const actions: BarAction[] = [];
  if (status === "idle") {
    actions.push({ label: "开始解析", primary: true, onClick: parse });
  } else if (status === "working") {
    actions.push({
      label: online ? "解析中…" : "解析中…",
      primary: true,
      disabled: true,
      onClick: () => {},
    });
  } else {
    actions.push({ label: "解析新链接", primary: true, onClick: reset });
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-28 pt-10 sm:px-8 md:pb-16">
      <Link
        href="/#tools"
        className="inline-flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回工具列表
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">
          无水印解析
          <span className="ml-3 text-base font-normal text-white/35">
            Watermark-free Parser
          </span>
        </h1>
        <ServiceStatusPill />
      </div>
      <p className="mt-3 text-sm text-white/45">
        粘贴分享链接，拿回干净的原画质视频。
        {online
          ? "媒体服务已连接，将调用真实解析管道。"
          : "媒体服务未连接，当前为演示流程。"}
      </p>

      <div className="glass shadow-card mt-8 rounded-3xl p-6 sm:p-8">
        {/* 平台选择（视觉提示，后端自动识别） */}
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              disabled={status === "working"}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-all duration-200",
                platform === p
                  ? "border-aurora-cyan/50 bg-aurora-cyan/10 text-white shadow-glow-cyan"
                  : "border-white/10 bg-white/[0.02] text-white/50 hover:border-white/25 hover:text-white",
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* 链接输入 */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && parse()}
              placeholder="粘贴抖音 / 快手 / 小红书 / TikTok 分享链接…"
              disabled={status === "working"}
              className="w-full rounded-2xl border border-white/10 bg-black/40 py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-white/25 outline-none transition-colors focus:border-aurora-cyan/50 disabled:opacity-50"
            />
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => {
                navigator.clipboard
                  ?.readText()
                  .then((t) => t && setUrl(t))
                  .catch(() => setHint("无法读取剪贴板，请手动粘贴"));
              }}
              disabled={status === "working"}
              className="btn-ghost shrink-0 !px-4"
              aria-label="从剪贴板粘贴"
            >
              <ClipboardPaste className="h-4 w-4" />
              <span className="sm:hidden">粘贴</span>
            </button>
            <button
              onClick={parse}
              disabled={status === "working"}
              className="btn-primary hidden shrink-0 disabled:opacity-40 sm:inline-flex"
            >
              开始解析
            </button>
          </div>
        </div>

        {hint && (
          <p className="mt-3 flex items-start gap-2 text-xs text-amber-300/90">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{hint}</span>
          </p>
        )}

        {/* 进度 */}
        <AnimatePresence>
          {status === "working" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-6">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  {online ? (
                    <div
                      className="h-full animate-shimmer rounded-full bg-gradient-to-r from-aurora-cyan via-aurora-blue to-aurora-violet"
                      style={{ backgroundSize: "200% 100%", width: "100%" }}
                    />
                  ) : (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-aurora-cyan via-aurora-blue to-aurora-violet transition-all duration-700"
                      style={{ width: `${progress}%` }}
                    />
                  )}
                </div>
                {online ? (
                  <p className="mt-3 text-sm text-white/65">
                    正在请求解析服务，请稍候…
                  </p>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={stageIdx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="mt-3 text-sm text-white/65"
                    >
                      {STAGES[Math.min(stageIdx, STAGES.length - 1)]}
                    </motion.p>
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 真实解析结果 */}
        <AnimatePresence>
          {status === "done" && realResult && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 overflow-hidden rounded-2xl border border-white/10"
            >
              <div className="flex flex-col gap-5 p-5 sm:flex-row">
                <div className="relative h-44 w-full shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-aurora-violet/40 via-ink-800 to-aurora-cyan/30 sm:w-36">
                  {realResult.cover_url ? (
                    <img
                      src={realResult.cover_url}
                      alt="视频封面"
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <Play className="h-10 w-10 text-white/70" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold leading-snug text-white">
                    {realResult.title || "（无标题）"}
                  </h3>
                  <dl className="mt-3 space-y-1.5 text-xs text-white/45">
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">平台</dt>
                      <dd>{realResult.platform}</dd>
                    </div>
                    {realResult.author && (
                      <div className="flex gap-2">
                        <dt className="w-14 shrink-0 text-white/30">作者</dt>
                        <dd className="truncate">{realResult.author}</dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">策略</dt>
                      <dd className="font-mono text-white/60">
                        {realResult.strategy}
                      </dd>
                    </div>
                    {realResult.warnings.map((w) => (
                      <div key={w} className="flex gap-2">
                        <dt className="w-14 shrink-0 text-white/30">注意</dt>
                        <dd className="text-amber-300/90">{w}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <a
                      href={realResult.video_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary !px-5 !py-2.5 !text-[13px]"
                    >
                      <Download className="h-4 w-4" />
                      打开原视频
                      <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                    </a>
                    <button
                      onClick={() => copyLink(realResult.video_url)}
                      className="btn-ghost !px-5 !py-2.5 !text-[13px]"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copied ? "已复制" : "复制直链"}
                    </button>
                    <button
                      onClick={reset}
                      className="btn-ghost !px-5 !py-2.5 !text-[13px]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      解析新链接
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 离线演示结果 */}
        <AnimatePresence>
          {status === "done" && !realResult && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 overflow-hidden rounded-2xl border border-white/10"
            >
              <div className="flex flex-col gap-5 p-5 sm:flex-row">
                <div className="relative grid h-44 w-full shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-aurora-violet/40 via-ink-800 to-aurora-cyan/30 sm:w-32">
                  <Play className="h-10 w-10 text-white/70" />
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-aurora-violet/20 px-2.5 py-1 text-[11px] text-aurora-violet backdrop-blur-xl">
                    原型演示
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[15px] font-semibold text-white">
                    示例视频标题（原型演示数据）
                  </h3>
                  <dl className="mt-3 space-y-1.5 text-xs text-white/45">
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">平台</dt>
                      <dd>{platform === "自动识别" ? "抖音（示例）" : platform}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">时长</dt>
                      <dd className="font-mono">00:23</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">画质</dt>
                      <dd className="font-mono">1080 × 1920 · 无水印</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-white/30">大小</dt>
                      <dd className="font-mono">8.6 MB</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button
                      onClick={() =>
                        setHint("真实解析管道（Headless + 正则 + 第三方回退）将在阶段三接入")
                      }
                      className="btn-primary !px-5 !py-2.5 !text-[13px]"
                    >
                      <Download className="h-4 w-4" />
                      下载原视频
                    </button>
                    <button
                      onClick={reset}
                      className="btn-ghost !px-5 !py-2.5 !text-[13px]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      解析新链接
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <MobileActionBar actions={actions} />
    </div>
  );
}
