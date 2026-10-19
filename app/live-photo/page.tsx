"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileImage,
  Film,
  RotateCcw,
  Scissors,
  Volume2,
  VolumeX,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Dropzone } from "@/components/tools/dropzone";
import { SegmentedControl } from "@/components/tools/segmented-control";
import { RangeTimeline } from "@/components/tools/range-timeline";
import {
  MobileActionBar,
  type BarAction,
} from "@/components/tools/mobile-action-bar";
import { ServiceStatusPill } from "@/components/tools/service-status";
import { useMediaService } from "@/hooks/use-media-service";
import { livePhotoConvert, type LivePhotoResult, type LivePhotoParams } from "@/lib/media-client";
import {
  DURATION_MODES,
  FALLBACKS,
  FALLBACK_LABEL,
  effectiveWindow,
  formatClock,
  newContentIdentifier,
  type DurationMode,
  type FallbackStrategy,
  type VideoCodec,
} from "@/lib/livephoto";
import { cn } from "@/lib/utils";

type Step = "upload" | "ready" | "working" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "上传视频" },
  { id: "ready", label: "一键生成" },
  { id: "done", label: "完成" },
];

/** 离线演示模式的分阶段文案 */
const STAGES = [
  "正在提取关键帧…",
  "正在重封装为 H.264 / HEVC…",
  "正在注入实况元数据…",
  "正在打包下载文件…",
];

/** 真实转码中的阶段文案（按耗时轮播） */
const REAL_STAGES = [
  "上传视频到媒体服务…",
  "FFmpeg 转码封装中…",
  "注入实况元数据并校验…",
  "打包完成，准备下载…",
];

/** 高级裁剪里视频解码超时（毫秒）：超时只提示，不阻塞生成 */
const DECODE_TIMEOUT_MS = 15000;

export default function LivePhotoPage() {
  const [step, setStep] = useState<Step>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");

  // 一键生成的默认参数（无需解码，后端自动探测时长）
  const [durationMode, setDurationMode] = useState<DurationMode>(3);
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [muted, setMuted] = useState(true);
  const [fallback, setFallback] = useState<FallbackStrategy>("pingpong");

  // 高级：自定义截取片段（需要浏览器解码预览，失败不阻塞）
  const [customClip, setCustomClip] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [keyframe, setKeyframe] = useState(0);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const [stageIdx, setStageIdx] = useState(0);

  // 真实任务状态
  const [realResult, setRealResult] = useState<LivePhotoResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const jobRunning = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const serviceStatus = useMediaService();
  const online = serviceStatus === "online";

  const win = effectiveWindow(videoDuration, durationMode);

  // 切换 / 卸载时释放对象 URL
  useEffect(() => {
    const url = videoUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoUrl]);

  const handleFiles = (files: File[]) => {
    const f = files[0];
    if (!f) {
      setVideoFile(null);
      setVideoUrl(null);
      setStep("upload");
      return;
    }
    setVideoFile(f);
    setVideoUrl(URL.createObjectURL(f));
    setVideoName(f.name);
    // 重置高级裁剪状态
    setCustomClip(false);
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);
    setRealResult(null);
    setJobError(null);
    setStep("ready");
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName("");
    setCustomClip(false);
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);
    setStageIdx(0);
    setRealResult(null);
    setJobError(null);
    setStep("upload");
  };

  /** 高级裁剪：视频元数据就绪（仅在展开自定义片段时触发） */
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration) || v.duration <= 0) {
      setDecodeError("无法读取该视频时长，仍可直接生成。");
      return;
    }
    const d = v.duration;
    setDecodeError(null);
    setVideoDuration(d);
    setClipStart(0);
    setKeyframe(Math.round((effectiveWindow(d, durationMode) / 2) * 100) / 100);
  };

  /** 高级裁剪：解码超时保护——只提示，绝不卡死 */
  useEffect(() => {
    if (!customClip) return;
    setDecodeError(null);
    const t = window.setTimeout(() => {
      const d = videoRef.current?.duration;
      if (!d || !isFinite(d)) {
        setDecodeError("视频解码超时，无法预览片段；不影响一键生成。");
      }
    }, DECODE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [customClip, videoUrl]);

  /** 切换 3s / 5s：窗口宽度联动，封面帧保持相对位置 */
  const changeMode = (m: DurationMode) => {
    const oldWin = effectiveWindow(videoDuration, durationMode);
    const newWin = effectiveWindow(videoDuration, m);
    const newStart = Math.min(clipStart, Math.max(0, videoDuration - newWin));
    const frac = oldWin > 0 ? (keyframe - clipStart) / oldWin : 0.5;
    const nk = Math.min(
      Math.max(newStart + frac * newWin, newStart),
      newStart + newWin,
    );
    setDurationMode(m);
    setClipStart(newStart);
    setKeyframe(Math.round(nk * 100) / 100);
  };

  /** 拖动窗口：封面帧跟随窗口平移 */
  const handleStartChange = (s: number) => {
    const delta = s - clipStart;
    setClipStart(s);
    setKeyframe((k) =>
      Math.round(Math.min(Math.max(k + delta, s), s + win) * 100) / 100,
    );
    const v = videoRef.current;
    if (v && isFinite(v.duration)) {
      try {
        v.currentTime = s;
      } catch {
        /* 忽略 seek 失败 */
      }
    }
  };

  const buildParams = (): LivePhotoParams => ({
    durationMode,
    clipStart: customClip ? clipStart : 0,
    // 未自定义时传 null，后端自动取片段中点
    keyframeTime: customClip ? keyframe : null,
    fallback,
    codec,
    muted,
    audioFadeSecs: 0.2,
    contentIdentifier: newContentIdentifier(),
  });

  /** 真实转码任务 */
  const runRealJob = async () => {
    if (jobRunning.current || !videoFile) return;
    jobRunning.current = true;
    try {
      const r = await livePhotoConvert(videoFile, buildParams());
      setRealResult(r);
      setStep("done");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "转码失败，请重试");
      setStep("ready");
    } finally {
      jobRunning.current = false;
    }
  };

  const generate = () => {
    setJobError(null);
    setRealResult(null);
    setStageIdx(0);
    setElapsed(0);
    setStep("working");
    if (online) {
      runRealJob();
    }
    // 离线 → 由下方 effect 驱动演示进度
  };

  // 离线演示模式：模拟分阶段进度
  useEffect(() => {
    if (step !== "working" || online) return;
    if (stageIdx >= STAGES.length) {
      const t = window.setTimeout(() => setStep("done"), 600);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setStageIdx((i) => i + 1), 950);
    return () => window.clearTimeout(t);
  }, [step, stageIdx, online]);

  // 真实转码：耗时计时
  useEffect(() => {
    if (step !== "working" || !online) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [step, online]);

  const progress = Math.min(100, ((stageIdx + 1) / STAGES.length) * 100);
  const activeIdx = STEPS.findIndex((s) => s.id === step);
  const realStage =
    REAL_STAGES[Math.min(Math.floor(elapsed / 6), REAL_STAGES.length - 1)];

  const actions: BarAction[] = [];
  if (step === "ready") {
    actions.push({ label: "重新选择", onClick: () => setStep("upload") });
    actions.push({ label: "开始生成", primary: true, onClick: generate });
  } else if (step === "done") {
    actions.push({ label: "再做一个", primary: true, onClick: reset });
  }

  const sizeMB = videoFile ? (videoFile.size / 1048576).toFixed(1) : "0";

  return (
    <div className="mx-auto max-w-4xl px-5 pb-28 pt-10 sm:px-8 md:pb-16">
      <Link
        href="/#tools"
        className="inline-flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        返回工具列表
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">
          实况工坊
          <span className="ml-3 text-base font-normal text-white/35">
            Live Photo Studio
          </span>
        </h1>
        <ServiceStatusPill />
      </div>

      {/* 步骤条 */}
      <div className="mt-8 flex items-center">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full text-xs font-semibold transition-all duration-300",
                  i < activeIdx
                    ? "bg-aurora-violet/25 text-aurora-violet"
                    : i === activeIdx
                      ? "bg-gradient-to-br from-aurora-violet to-aurora-cyan text-white shadow-glow-violet"
                      : "bg-white/[0.06] text-white/35",
                )}
              >
                {i < activeIdx ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm sm:block",
                  i <= activeIdx ? "text-white" : "text-white/35",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 h-px flex-1 transition-colors duration-300",
                  i < activeIdx ? "bg-aurora-violet/50" : "bg-white/10",
                )}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mt-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === "upload" && (
              <Dropzone
                accept="video/*"
                maxSizeMB={200}
                hint="支持 MP4 / MOV 等视频格式 · 最大 200MB"
                onFiles={handleFiles}
              />
            )}

            {step === "ready" && videoFile && (
              <div className="space-y-5">
                {jobError && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{jobError}</span>
                  </div>
                )}

                {!online && (
                  <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-center text-xs text-white/40">
                    媒体服务未连接，当前为演示流程；后端上线后将调用真实转码
                  </p>
                )}

                {/* 文件卡片 */}
                <div className="glass shadow-card flex items-center gap-4 rounded-3xl p-5">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-aurora-violet/25 to-aurora-cyan/25">
                    <Film className="h-6 w-6 text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {videoName}
                    </p>
                    <p className="mt-1 text-xs text-white/40">
                      {sizeMB} MB · 默认从开头截取 {durationMode}s，封面帧自动取中点
                    </p>
                  </div>
                  <button
                    onClick={() => setStep("upload")}
                    className="flex shrink-0 items-center gap-1.5 text-xs text-white/45 transition-colors hover:text-white"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    换一个
                  </button>
                </div>

                {/* 一键生成 */}
                <button onClick={generate} className="btn-primary w-full !py-4 !text-base">
                  开始生成实况照片
                </button>

                {/* 高级设置 */}
                <details className="group glass rounded-3xl">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-white/70 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                    高级设置
                    <ChevronDown className="h-4 w-4 text-white/40 transition-transform duration-300 group-open:rotate-180" />
                  </summary>
                  <div className="space-y-5 border-t border-white/10 px-5 py-5">
                    <SegmentedControl
                      id="ready-duration"
                      options={DURATION_MODES}
                      value={durationMode}
                      onChange={changeMode}
                    />

                    <div>
                      <label className="mb-2.5 block text-sm text-white/70">
                        编码格式
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {(
                          [
                            { id: "h264", label: "H.264", desc: "兼容性最好" },
                            { id: "hevc", label: "HEVC", desc: "体积更小" },
                          ] as const
                        ).map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setCodec(c.id)}
                            className={cn(
                              "rounded-2xl border p-4 text-left transition-all duration-200",
                              codec === c.id
                                ? "border-aurora-violet/60 bg-aurora-violet/[0.08] shadow-glow-violet"
                                : "border-white/10 bg-white/[0.02] hover:border-white/25",
                            )}
                          >
                            <span className="block text-sm font-semibold text-white">
                              {c.label}
                            </span>
                            <span className="mt-1 block text-xs text-white/40">
                              {c.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => setMuted((m) => !m)}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/25"
                    >
                      <span className="flex items-center gap-3 text-sm text-white/80">
                        {muted ? (
                          <VolumeX className="h-5 w-5 text-aurora-violet" />
                        ) : (
                          <Volume2 className="h-5 w-5 text-aurora-cyan" />
                        )}
                        {muted ? "静音导出（推荐）" : "保留原声"}
                      </span>
                      <span
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors duration-200",
                          muted ? "bg-aurora-violet" : "bg-white/15",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200",
                            muted ? "left-[22px]" : "left-0.5",
                          )}
                        />
                      </span>
                    </button>

                    <div>
                      <label className="mb-2.5 block text-sm text-white/70">
                        视频短于目标时长时的补齐方式
                      </label>
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        {FALLBACKS.map((f) => (
                          <button
                            key={f.value}
                            onClick={() => setFallback(f.value)}
                            className={cn(
                              "rounded-2xl border p-3.5 text-left transition-all duration-200",
                              fallback === f.value
                                ? "border-aurora-violet/60 bg-aurora-violet/[0.08]"
                                : "border-white/10 bg-white/[0.02] hover:border-white/25",
                            )}
                          >
                            <span className="text-sm font-semibold text-white">
                              {f.label}
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-white/45">
                              {f.desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 自定义截取片段 */}
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <button
                        onClick={() => setCustomClip((c) => !c)}
                        className="flex w-full items-center justify-between text-sm text-white/80 transition-colors hover:text-white"
                      >
                        <span className="flex items-center gap-2">
                          <Scissors className="h-4 w-4 text-amber-200" />
                          自定义截取片段与封面帧
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-white/40 transition-transform duration-300",
                            customClip && "rotate-180",
                          )}
                        />
                      </button>

                      {customClip && (
                        <div className="mt-4 space-y-4">
                          {decodeError ? (
                            <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-200">
                              {decodeError}
                            </p>
                          ) : (
                            <>
                              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                                <video
                                  ref={videoRef}
                                  src={videoUrl ?? undefined}
                                  muted
                                  playsInline
                                  controls
                                  preload="auto"
                                  onLoadedMetadata={handleLoadedMetadata}
                                  onError={() =>
                                    setDecodeError(
                                      "该视频无法在浏览器中预览；仍可直接生成。",
                                    )
                                  }
                                  className="block max-h-[36vh] w-full object-contain"
                                />
                              </div>
                              {videoDuration > 0 && (
                                <>
                                  <RangeTimeline
                                    duration={videoDuration}
                                    windowSecs={durationMode}
                                    start={clipStart}
                                    keyframe={keyframe}
                                    onStartChange={handleStartChange}
                                    onKeyframeChange={(t) =>
                                      setKeyframe(Math.round(t * 100) / 100)
                                    }
                                  />
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="chip !border-amber-300/30 !bg-amber-300/[0.08] !text-amber-200">
                                      封面帧 @ {keyframe.toFixed(2)}s
                                    </span>
                                    <button
                                      onClick={() =>
                                        setKeyframe(
                                          Math.round(
                                            (clipStart + win / 2) * 100,
                                          ) / 100,
                                        )
                                      }
                                      className="text-xs text-white/45 underline-offset-4 hover:text-white hover:underline"
                                    >
                                      重置到片段中点
                                    </button>
                                  </div>
                                  <p className="text-[11px] text-white/30">
                                    截取区间 {formatClock(clipStart)} –{" "}
                                    {formatClock(clipStart + win)}
                                    ，封面帧将写入 still-image-time 元数据
                                  </p>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              </div>
            )}

            {step === "working" && (
              <div className="glass shadow-card rounded-3xl p-8 text-center sm:p-12">
                <div className="relative mx-auto h-20 w-20">
                  <div className="absolute inset-0 animate-breathe rounded-full bg-gradient-to-br from-aurora-violet/40 to-aurora-cyan/40 blur-xl" />
                  <div className="glass-strong relative grid h-20 w-20 place-items-center rounded-full">
                    <Film className="h-8 w-8 text-white" />
                  </div>
                </div>
                <div className="mx-auto mt-8 max-w-md">
                  {online ? (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-aurora-violet via-aurora-fuchsia to-aurora-cyan animate-shimmer"
                          style={{
                            backgroundSize: "200% 100%",
                            width: "100%",
                          }}
                        />
                      </div>
                      <p className="mt-4 text-sm text-white/65">{realStage}</p>
                      <p className="mt-1.5 font-mono text-xs text-white/35">
                        已耗时 {elapsed}s · 服务端正在转码，请稍候
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-aurora-violet via-aurora-fuchsia to-aurora-cyan transition-all duration-700"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-4 min-h-[24px]">
                        <AnimatePresence mode="wait">
                          <motion.p
                            key={stageIdx}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className="text-sm text-white/65"
                          >
                            {STAGES[Math.min(stageIdx, STAGES.length - 1)]}
                          </motion.p>
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="glass shadow-card rounded-3xl p-6 text-center sm:p-10">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15">
                  <Check className="h-7 w-7 text-emerald-300" />
                </span>
                <h2 className="font-display mt-4 text-2xl font-bold">
                  实况照片已生成
                  {!realResult && (
                    <span className="ml-2.5 rounded-full bg-aurora-violet/15 px-2.5 py-1 align-middle text-[11px] font-medium text-aurora-violet">
                      原型演示
                    </span>
                  )}
                </h2>

                {realResult ? (
                  <div className="mx-auto mt-6 max-w-md space-y-2.5 text-left">
                    <div className="overflow-hidden rounded-2xl border border-white/10">
                      <img
                        src={realResult.still_url}
                        alt="实况封面"
                        className="block w-full"
                      />
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-white/40">导出时长</span>
                        <span className="font-mono text-white">
                          {realResult.meta.export_duration.toFixed(1)}s
                        </span>
                      </div>
                      <div className="mt-1.5 flex justify-between gap-4">
                        <span className="text-white/40">封面帧</span>
                        <span className="font-mono text-amber-200">
                          {realResult.meta.keyframe_time.toFixed(2)}s → still-image-time{" "}
                          {realResult.meta.still_image_time}s
                        </span>
                      </div>
                      {realResult.meta.needs_fallback && (
                        <div className="mt-1.5 flex justify-between gap-4">
                          <span className="text-white/40">补齐方式</span>
                          <span className="text-amber-200">
                            {FALLBACK_LABEL[
                              realResult.meta.fallback as FallbackStrategy
                            ] ?? realResult.meta.fallback}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3.5">
                      <p className="text-[11px] tracking-wider text-white/35">
                        元数据校验通过（图片与视频严格匹配）
                      </p>
                      <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-white/60">
                        {realResult.meta.content_identifier}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
                      <a
                        href={realResult.download_url}
                        download
                        className="btn-primary"
                      >
                        <Download className="h-4 w-4" />
                        下载 ZIP（真实文件）
                      </a>
                      <button onClick={reset} className="btn-ghost">
                        <RotateCcw className="h-4 w-4" />
                        再做一个
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mx-auto mt-6 max-w-md space-y-2.5 text-left">
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
                        <FileImage className="h-5 w-5 shrink-0 text-aurora-cyan" />
                        <div className="text-sm">
                          <p className="font-mono text-white/85">IMG_COVER.HEIC</p>
                          <p className="mt-0.5 text-xs text-white/40">
                            封面帧 · 与视频共享 ContentIdentifier
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
                        <Film className="h-5 w-5 shrink-0 text-aurora-violet" />
                        <div className="text-sm">
                          <p className="font-mono text-white/85">IMG_COVER.MOV</p>
                          <p className="mt-0.5 text-xs text-white/40">
                            演示数据 · 后端上线后生成真实文件
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                      <button
                        disabled
                        title="后端上线后可下载真实文件"
                        className="btn-primary cursor-not-allowed opacity-40"
                      >
                        <Download className="h-4 w-4" />
                        下载 ZIP
                      </button>
                      <button onClick={reset} className="btn-ghost">
                        <RotateCcw className="h-4 w-4" />
                        再做一个
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 桌面端操作栏 */}
      {actions.length > 0 && step !== "working" && (
        <div className="mt-8 hidden justify-between md:flex">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={a.onClick}
              disabled={a.disabled}
              className={cn(a.primary ? "btn-primary" : "btn-ghost")}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {step !== "working" && <MobileActionBar actions={actions} />}
    </div>
  );
}
