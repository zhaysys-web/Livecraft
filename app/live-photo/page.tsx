"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Download,
  FileImage,
  Film,
  RotateCcw,
  Volume2,
  VolumeX,
  AlertCircle,
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
import {
  livePhotoConvert,
  type LivePhotoResult,
} from "@/lib/media-client";
import {
  DURATION_MODES,
  FALLBACKS,
  FALLBACK_LABEL,
  buildFfmpegArgs,
  effectiveWindow,
  exportDuration,
  formatClock,
  needsFallback,
  newContentIdentifier,
  type DurationMode,
  type FallbackStrategy,
  type LivePhotoJobParams,
  type VideoCodec,
} from "@/lib/livephoto";
import { cn } from "@/lib/utils";

type Step = "upload" | "clip" | "options" | "working" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "上传视频" },
  { id: "clip", label: "裁剪片段" },
  { id: "options", label: "转码设置" },
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

export default function LivePhotoPage() {
  const [step, setStep] = useState<Step>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);

  const [durationMode, setDurationMode] = useState<DurationMode>(3);
  const [clipStart, setClipStart] = useState(0);
  const [keyframe, setKeyframe] = useState(0);
  const [fallback, setFallback] = useState<FallbackStrategy>("pingpong");

  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [muted, setMuted] = useState(true);
  const [stageIdx, setStageIdx] = useState(0);
  const [jobParams, setJobParams] = useState<LivePhotoJobParams | null>(null);

  // 真实任务状态
  const [realResult, setRealResult] = useState<LivePhotoResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const jobRunning = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const serviceStatus = useMediaService();
  const online = serviceStatus === "online";

  const win = effectiveWindow(videoDuration, durationMode);
  const short = needsFallback(videoDuration, durationMode);

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
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setJobParams(null);
    setRealResult(null);
    setJobError(null);
    setStep("clip");
  };

  const reset = () => {
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName("");
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setStageIdx(0);
    setJobParams(null);
    setRealResult(null);
    setJobError(null);
    setStep("upload");
  };

  /** 视频元数据就绪：初始化窗口与封面帧（片段中点） */
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    const d = v.duration;
    setVideoDuration(d);
    setClipStart(0);
    setKeyframe(effectiveWindow(d, durationMode) / 2);
  };

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
    if (v && step === "clip") v.currentTime = s;
  };

  /** 预览播放器：在选中区间内循环 */
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || step !== "clip") return;
    const end = clipStart + win;
    if (v.currentTime >= end - 0.04) v.currentTime = clipStart;
  };

  // 进入裁剪步骤：从窗口起点自动播放预览
  useEffect(() => {
    const v = videoRef.current;
    if (v && step === "clip" && videoDuration > 0) {
      v.currentTime = clipStart;
      v.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const buildParams = (cid: string): LivePhotoJobParams => ({
    durationMode,
    clipStart: short ? 0 : clipStart,
    keyframeTime: short ? Math.min(keyframe, videoDuration) : keyframe,
    fallback,
    codec,
    muted,
    audioFadeSecs: 0.2,
    targetFps: 60,
    contentIdentifier: cid,
    videoDuration,
  });

  /** 真实转码任务 */
  const runRealJob = async () => {
    if (jobRunning.current || !videoFile) return;
    jobRunning.current = true;
    try {
      const r = await livePhotoConvert(
        videoFile,
        buildParams(newContentIdentifier()),
      );
      setRealResult(r);
      setStep("done");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "转码失败，请重试");
      setStep("options");
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
  if (step === "upload") {
    actions.push({
      label: videoUrl ? "下一步：裁剪片段" : "请先选择视频",
      primary: true,
      disabled: !videoUrl,
      onClick: () => setStep("clip"),
    });
  } else if (step === "clip") {
    actions.push({ label: "上一步", onClick: () => setStep("upload") });
    actions.push({
      label: "下一步：转码设置",
      primary: true,
      disabled: videoDuration <= 0,
      onClick: () => setStep("options"),
    });
  } else if (step === "options") {
    actions.push({ label: "上一步", onClick: () => setStep("clip") });
    actions.push({ label: "开始生成", primary: true, onClick: generate });
  } else if (step === "done") {
    actions.push({ label: "再做一个", primary: true, onClick: reset });
  }

  // 参数摘要（转码设置页）与 FFmpeg 预览共用
  const previewParams: LivePhotoJobParams | null =
    step === "options" || step === "done"
      ? (jobParams ?? {
          durationMode,
          clipStart: short ? 0 : clipStart,
          keyframeTime: keyframe,
          fallback,
          codec,
          muted,
          audioFadeSecs: 0.2,
          targetFps: 60,
          contentIdentifier: "UUID-将在生成时创建",
          videoDuration,
        })
      : null;
  const plan = previewParams ? buildFfmpegArgs(previewParams) : null;
  const exportSecs = previewParams ? exportDuration(previewParams) : 0;

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

            {step === "clip" && videoUrl && (
              <div className="space-y-5">
                {!online && (
                  <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-center text-xs text-white/40">
                    媒体服务未连接，当前为演示流程；启动 media-service 后将调用真实转码
                  </p>
                )}

                {/* 时长模式 */}
                <SegmentedControl
                  id="clip-duration"
                  options={DURATION_MODES}
                  value={durationMode}
                  onChange={changeMode}
                />

                {/* 预览播放器（区间循环） */}
                <div className="glass shadow-card rounded-3xl p-5 sm:p-6">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      className="block max-h-[42vh] w-full object-contain"
                    />
                  </div>
                  <p className="mt-3 text-center text-xs text-white/40">
                    预览循环播放当前选中区间（{formatClock(clipStart)} –{" "}
                    {formatClock(clipStart + win)}）
                  </p>

                  {/* 定长滑动裁剪 */}
                  <div className="mt-4">
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
                  </div>

                  {/* 封面帧 */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="chip !border-amber-300/30 !bg-amber-300/[0.08] !text-amber-200">
                      封面帧 @ {keyframe.toFixed(2)}s
                    </span>
                    <button
                      onClick={() =>
                        setKeyframe(
                          Math.round((clipStart + win / 2) * 100) / 100,
                        )
                      }
                      className="text-xs text-white/45 underline-offset-4 hover:text-white hover:underline"
                    >
                      重置到片段中点
                    </button>
                    <span className="text-[11px] text-white/30">
                      将写入 still-image-time 元数据
                    </span>
                  </div>
                </div>

                {/* 时长不足兜底 */}
                {short ? (
                  <div className="rounded-3xl border border-amber-300/25 bg-amber-300/[0.05] p-5 sm:p-6">
                    <p className="text-sm text-amber-200">
                      视频仅 {videoDuration.toFixed(1)}s，短于 {durationMode}s
                      目标，请选择补齐方式：
                    </p>
                    <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                      {FALLBACKS.map((f) => (
                        <button
                          key={f.value}
                          onClick={() => setFallback(f.value)}
                          className={cn(
                            "rounded-2xl border p-4 text-left transition-all duration-200",
                            fallback === f.value
                              ? "border-amber-300/60 bg-amber-300/[0.08]"
                              : "border-white/10 bg-white/[0.02] hover:border-white/25",
                          )}
                        >
                          <span className="text-sm font-semibold text-white">
                            {f.label}
                          </span>
                          <span className="ml-1.5 text-[11px] text-white/35">
                            {f.en}
                          </span>
                          <span className="mt-1.5 block text-xs leading-relaxed text-white/45">
                            {f.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  videoDuration > 0 && (
                    <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-center text-xs text-white/40">
                      视频 {videoDuration.toFixed(1)}s ≥ {durationMode}s，拖动窗口选取最精彩的{" "}
                      {durationMode}s 片段
                    </p>
                  )
                )}
              </div>
            )}

            {step === "options" && previewParams && (
              <div className="space-y-5">
                {jobError && (
                  <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{jobError}</span>
                  </div>
                )}

                <SegmentedControl
                  id="opt-duration"
                  options={DURATION_MODES}
                  value={durationMode}
                  onChange={changeMode}
                />

                <div className="glass shadow-card rounded-3xl p-6 sm:p-8">
                  <h2 className="font-display text-lg font-semibold">
                    转码设置
                  </h2>

                  <div className="mt-6">
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
                    className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/25"
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
                  {!muted && (
                    <p className="mt-2 text-xs text-white/35">
                      片段首尾自动添加 0.2s 音频淡入淡出，防止爆音
                    </p>
                  )}

                  {/* 参数摘要 */}
                  <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-5">
                    <h3 className="text-xs font-semibold tracking-[0.2em] text-white/40">
                      任务参数摘要
                    </h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/40">时长模式</dt>
                        <dd className="text-white">
                          {durationMode}s
                          {durationMode === 3 ? "（原生兼容）" : "（超长实况）"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/40">截取区间</dt>
                        <dd className="font-mono text-white">
                          {formatClock(previewParams.clipStart)} –{" "}
                          {formatClock(
                            previewParams.clipStart +
                              effectiveWindow(
                                videoDuration,
                                previewParams.durationMode,
                              ),
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/40">封面帧</dt>
                        <dd className="font-mono text-amber-200">
                          {previewParams.keyframeTime.toFixed(2)}s → still-image-time
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/40">导出时长</dt>
                        <dd className="font-mono text-white">
                          {exportSecs.toFixed(1)}s
                        </dd>
                      </div>
                      {short && (
                        <div className="flex justify-between gap-4">
                          <dt className="text-white/40">兜底策略</dt>
                          <dd className="text-amber-200">
                            {FALLBACK_LABEL[fallback]}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-4">
                        <dt className="text-white/40">处理通道</dt>
                        <dd className={online ? "text-emerald-300" : "text-white/50"}>
                          {online ? "媒体服务真实转码" : "演示模式"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* FFmpeg 参数预览（阶段三联调） */}
                  {plan && (
                    <details className="group mt-4 rounded-2xl border border-white/10 bg-black/30">
                      <summary className="cursor-pointer list-none px-5 py-4 text-sm text-white/60 transition-colors hover:text-white">
                        查看 FFmpeg 参数
                        <span className="ml-2 text-[11px] text-white/30">
                          （后端实际执行的参数）
                        </span>
                      </summary>
                      <div className="space-y-4 border-t border-white/10 px-5 py-4">
                        <div>
                          <p className="mb-1.5 text-[11px] tracking-wider text-white/35">
                            视频封装
                          </p>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-aurora-cyan/90">
                            {plan.videoArgs.join(" ")}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1.5 text-[11px] tracking-wider text-white/35">
                            封面帧提取
                          </p>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-aurora-violet/90">
                            {plan.stillArgs.join(" ")}
                          </pre>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
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
                          <span className="text-white/40">兜底策略</span>
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
                            演示数据 · 启动媒体服务后生成真实文件
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                      <button
                        disabled
                        title="启动 media-service 后可下载真实文件"
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
