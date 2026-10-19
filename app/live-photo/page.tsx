"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Film,
  Loader2,
  RotateCcw,
  Scissors,
  Share2,
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
import { WeChatTip } from "@/components/tools/wechat-tip";
import { useMediaService } from "@/hooks/use-media-service";
import {
  deleteLivePhotoJob,
  livePhotoConvert,
  type LivePhotoResult,
  type LivePhotoParams,
} from "@/lib/media-client";
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

/** 高级裁剪里视频解码超时（毫秒）：超时只提示，不阻塞生成 */
const DECODE_TIMEOUT_MS = 15000;

type FileShareNavigator = Navigator & {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title?: string }) => Promise<void>;
};

function supportsFileShare(files: File[]): boolean {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    files.length !== 2
  ) {
    return false;
  }
  const nav = navigator as FileShareNavigator;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return false;
  }
  try {
    return Boolean(nav.canShare({ files }));
  } catch {
    return false;
  }
}

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

  // 时间轴与封面帧（浏览器解码失败时仍可直接生成）
  const [videoDuration, setVideoDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [keyframe, setKeyframe] = useState(0);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // 真实任务状态
  const [realResult, setRealResult] = useState<LivePhotoResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const jobRunning = useRef(false);
  /** 真实阶段：upload=上传中，process=服务端处理中（替代原来的时间轮播假进度） */
  const [jobPhase, setJobPhase] = useState<"upload" | "process" | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    loaded: number;
    total: number;
  } | null>(null);

  // 转换完成后先预取两个文件；点击按钮时只剩同步的 navigator.share 调用。
  const [shareFiles, setShareFiles] = useState<File[]>([]);
  const [shareSupported, setShareSupported] = useState(false);
  const [shareState, setShareState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  /** 相册文件下载进度（字节）；total 为 null 时只显示已下载量 */
  const [shareProgress, setShareProgress] = useState<{
    loaded: number;
    total: number | null;
  } | null>(null);

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
    // 重置时间轴与结果状态
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);
    setRealResult(null);
    setJobError(null);
    setShareFiles([]);
    setShareSupported(false);
    setShareState("idle");
    setShareError(null);
    setShareNotice(null);
    setStep("ready");
  };

  const reset = () => {
    if (realResult?.job_id) {
      void deleteLivePhotoJob(realResult.job_id).catch(() => {});
    }
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName("");
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);
    setRealResult(null);
    setJobError(null);
    setShareFiles([]);
    setShareSupported(false);
    setShareState("idle");
    setShareError(null);
    setShareNotice(null);
    setStep("upload");
  };

  /** 视频元数据就绪：初始化定长裁剪窗口与封面帧。 */
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
    try {
      v.currentTime = 0;
      void v.play().catch(() => {});
    } catch {
      // 自动播放被拦截时保留手动播放能力。
    }
  };

  /** 解码超时保护——只提示，绝不卡死生成流程。 */
  useEffect(() => {
    if (step !== "ready" || !videoUrl) return;
    setDecodeError(null);
    const t = window.setTimeout(() => {
      const d = videoRef.current?.duration;
      if (!d || !isFinite(d)) {
        setDecodeError("视频解码超时，无法预览片段；不影响一键生成。");
      }
    }, DECODE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [step, videoUrl]);

  /** 切换 3s / 5s：窗口宽度联动，封面帧保持相对位置 */
  const changeMode = (m: DurationMode) => {
    const oldWin = effectiveWindow(videoDuration, durationMode);
    const newWin = effectiveWindow(videoDuration, m);
    const newStart = Math.min(clipStart, Math.max(0, videoDuration - newWin));
    const frac = oldWin > 0 ? (keyframe - clipStart) / oldWin : 0.5;
    const nk = Math.min(
      Math.max(newStart + frac * newWin, newStart),
      Math.max(newStart, newStart + newWin - 0.02),
    );
    setDurationMode(m);
    setClipStart(newStart);
    setKeyframe(Math.round(nk * 100) / 100);
  };

  /** 拖动窗口：封面帧跟随窗口平移 */
  const handleStartChange = (s: number) => {
    const delta = s - clipStart;
    const latestKeyframe = Math.max(s, s + win - 0.02);
    setClipStart(s);
    setKeyframe((k) =>
      Math.round(Math.min(Math.max(k + delta, s), latestKeyframe) * 100) / 100,
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

  /** 选择封面帧：暂停并即时跳到该帧供预览确认。 */
  const handleKeyframeChange = (t: number) => {
    const latest = Math.max(clipStart, clipStart + win - 0.02);
    const next = Math.min(Math.max(t, clipStart), latest);
    setKeyframe(Math.round(next * 100) / 100);
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    try {
      v.pause();
      v.currentTime = t;
    } catch {
      // 某些移动浏览器可能拒绝 seek，不影响生成。
    }
  };

  const handleVideoTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || videoDuration <= 0) return;
    const end = clipStart + win;
    if (v.currentTime >= end || v.currentTime < clipStart - 0.05) {
      try {
        v.currentTime = clipStart;
      } catch {
        // 忽略 seek 失败。
      }
    }
  };

  const buildParams = (): LivePhotoParams => ({
    durationMode,
    clipStart: videoDuration > 0 ? clipStart : 0,
    // 浏览器无法解码时交给后端自动取片段中点。
    keyframeTime: videoDuration > 0 ? keyframe : null,
    fallback,
    codec,
    muted,
    audioFadeSecs: 0.2,
    contentIdentifier: newContentIdentifier(),
  });

  /** 真实媒体处理任务 */
  const runRealJob = async () => {
    if (jobRunning.current || !videoFile) return;
    jobRunning.current = true;
    setUploadProgress(null);
    setJobPhase("upload");
    try {
      const r = await livePhotoConvert(videoFile, buildParams(), (loaded, total) => {
        setUploadProgress({ loaded, total });
        // 上传完成（loaded 追上 total）后切换为服务端处理阶段
        if (total > 0 && loaded >= total) setJobPhase("process");
      });
      setRealResult(r);
      setStep("done");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "生成失败，请重试");
      setStep("ready");
    } finally {
      jobRunning.current = false;
      setJobPhase(null);
      setUploadProgress(null);
    }
  };

  const generate = () => {
    setJobError(null);
    setRealResult(null);
    setElapsed(0);
    setStep("working");
    // 健康检查只用于提示，不能阻断真实转换：Render 冷启动时状态可能仍是 checking。
    runRealJob();
  };

  /** 转换一完成就预取 JPG/MOV，保证点击时不必等待网络。 */
  useEffect(() => {
    if (!realResult) {
      setShareFiles([]);
      setShareSupported(false);
      setShareState("idle");
      setShareError(null);
      setShareProgress(null);
      return;
    }

    const controller = new AbortController();
    setShareState("loading");
    setShareError(null);
    setShareSupported(false);
    setShareNotice(null);
    setShareProgress({ loaded: 0, total: null });

    /** 流式下载并上报进度（无 Content-Length 时只显示已下载量） */
    const fetchBlobWithProgress = async (
      url: string,
      key: "still" | "mov",
      tracker: Record<"still" | "mov", { loaded: number; total: number | null }>,
    ): Promise<Blob> => {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error("生成文件暂时无法读取");
      const total = Number(res.headers.get("content-length")) || null;
      tracker[key] = { loaded: 0, total };
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        chunks.push(value);
        tracker[key].loaded += value.byteLength;
        const loaded = tracker.still.loaded + tracker.mov.loaded;
        const t = tracker.still.total;
        const t2 = tracker.mov.total;
        setShareProgress({
          loaded,
          total: t != null && t2 != null ? t + t2 : null,
        });
      }
      return new Blob(chunks, {
        type: res.headers.get("content-type") ?? undefined,
      });
    };

    const prepare = async () => {
      try {
        const tracker = {
          still: { loaded: 0, total: null as number | null },
          mov: { loaded: 0, total: null as number | null },
        };
        const [stillBlob, movBlob] = await Promise.all([
          fetchBlobWithProgress(realResult.still_url, "still", tracker),
          fetchBlobWithProgress(realResult.mov_url, "mov", tracker),
        ]);
        if (!stillBlob.size || !movBlob.size) {
          throw new Error("生成文件为空");
        }
        const baseName =
          realResult.meta.file_base_name ||
          `IMG_${realResult.job_id.toUpperCase()}`;
        const files = [
          new File([stillBlob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
          // MIME 用 video/mp4：iOS 分享面板对 video/quicktime 的 UTI 映射不稳定，
          // 实测曾把 .MOV 识别成"文稿"导致无法存入相册配对成实况照片
          new File([movBlob], `${baseName}.mov`, {
            type: "video/mp4",
            lastModified: Date.now(),
          }),
        ];
        if (controller.signal.aborted) return;
        setShareFiles(files);
        setShareSupported(supportsFileShare(files));
        setShareState("ready");
        setShareProgress(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setShareState("error");
        setShareProgress(null);
        setShareError(
          error instanceof Error ? error.message : "相册文件准备失败",
        );
      }
    };

    void prepare();
    return () => controller.abort();
  }, [realResult]);

  /** navigator.share 必须在点击的同步调用栈里直接执行。 */
  const saveToPhotos = () => {
    const files = shareFiles;
    const nav = navigator as FileShareNavigator;
    if (shareState === "loading") {
      setShareNotice("正在准备相册文件，请稍候再点。");
      return;
    }
    if (shareState === "error" || files.length !== 2) {
      setShareNotice(
        shareError
          ? `相册文件准备失败：${shareError}。请使用 ZIP 兜底。`
          : "相册文件尚未准备好，请使用 ZIP 兜底。",
      );
      return;
    }
    if (typeof nav.share !== "function") {
      setShareNotice("当前浏览器不支持系统分享，请使用 ZIP 兜底。");
      return;
    }
    if (!window.isSecureContext) {
      setShareNotice("直接存入相册需要 HTTPS，普通局域网 HTTP 只能使用 ZIP。");
      return;
    }

    let canShare = false;
    try {
      canShare =
        typeof nav.canShare === "function" && nav.canShare({ files });
    } catch {
      canShare = false;
    }
    if (!canShare) {
      setShareNotice("系统没有授予文件分享能力，请使用 ZIP 兜底。");
      return;
    }

    let sharePromise: Promise<void>;
    try {
      // 保持同步调用链：canShare 与 share 之间没有任何 await / 网络请求。
      sharePromise = nav.share({ files, title: "LiveCraft 实况照片" });
      setShareNotice("已打开系统面板，请选择「存储 2 个项目」。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setShareNotice("系统拦截了分享面板，请再点一次「直接存入相册」。");
        return;
      }
      setShareNotice("系统分享未能打开，请使用 ZIP 兜底。");
      return;
    }

    void sharePromise.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        error instanceof DOMException &&
        error.name === "NotAllowedError"
      ) {
        setShareNotice("系统拦截了分享面板，请再点一次「直接存入相册」。");
        return;
      }
      setShareNotice("系统分享未能打开，请使用 ZIP 兜底。");
    });
  };

  // 真实处理：耗时计时
  useEffect(() => {
    if (step !== "working") return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  const activeIdx =
    step === "working" ? 1 : STEPS.findIndex((s) => s.id === step);

  const actions: BarAction[] = [];
  if (step === "ready") {
    actions.push({ label: "重新选择", onClick: () => setStep("upload") });
    actions.push({ label: "开始生成", primary: true, onClick: generate });
  } else if (step === "done") {
    actions.push({
      label: shareState === "loading" ? "准备相册文件…" : "直接存入相册",
      primary: true,
      disabled: shareState === "loading",
      onClick: saveToPhotos,
    });
    actions.push({ label: "再做一个", onClick: reset });
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
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
            {step === "upload" && (
              <Dropzone
                accept="video/*"
                maxSizeMB={100}
                hint="支持 MP4 / MOV 等视频格式 · 最大 100MB（CDN 上传上限）"
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
                    媒体服务暂时未连通，仍会尝试真实转换；失败时请检查后端或刷新页面
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
                      {sizeMB} MB · 可拖动时间轴选择 {durationMode}s 精彩片段
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

                {/* 时长模式 */}
                <div className="glass rounded-3xl p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-white/85">
                        实况时长
                      </p>
                      <p className="mt-0.5 text-xs text-white/35">
                        定长裁剪窗口，切换后时间轴与导出参数实时同步
                      </p>
                    </div>
                    <span className="chip !border-emerald-300/25 !bg-emerald-300/[0.07] !text-emerald-200">
                      原画质优先 · 兼容则流复制
                    </span>
                  </div>
                  <SegmentedControl
                    id="ready-duration"
                    options={DURATION_MODES}
                    value={durationMode}
                    onChange={changeMode}
                  />
                  <p className="mt-2.5 text-[11px] leading-relaxed text-white/30">
                    兼容 H.264 / HEVC 视频走原码流复制，不重新编码；流复制边界受源视频关键帧影响，成片时长可能有约 0.1–0.2 秒误差。
                  </p>
                </div>

                {/* 预览与定长滑动裁剪 */}
                <div className="glass rounded-3xl p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-white/85">
                      <Scissors className="h-4 w-4 text-amber-200" />
                      选择精彩片段与封面帧
                    </p>
                    <span className="font-mono text-[11px] text-white/35">
                      {videoDuration > 0
                        ? `总时长 ${formatClock(videoDuration)}`
                        : "读取时长中…"}
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl ?? undefined}
                      muted
                      autoPlay
                      playsInline
                      controls
                      preload="auto"
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleVideoTimeUpdate}
                      onError={() =>
                        setDecodeError(
                          "该视频无法在浏览器中预览；仍可直接生成，后端会完成裁切。",
                        )
                      }
                      className="block max-h-[42vh] w-full object-contain"
                    />
                  </div>
                  {decodeError ? (
                    <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-200">
                      {decodeError}
                    </p>
                  ) : videoDuration > 0 ? (
                    <div className="mt-4 space-y-3">
                      <RangeTimeline
                        duration={videoDuration}
                        windowSecs={durationMode}
                        start={clipStart}
                        keyframe={keyframe}
                        onStartChange={handleStartChange}
                        onKeyframeChange={handleKeyframeChange}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="chip !border-amber-300/30 !bg-amber-300/[0.08] !text-amber-200">
                          封面帧 @ {keyframe.toFixed(2)}s
                        </span>
                        <button
                          onClick={() =>
                            handleKeyframeChange(
                              Math.round((clipStart + win / 2) * 100) / 100,
                            )
                          }
                          className="text-xs text-white/45 underline-offset-4 hover:text-white hover:underline"
                        >
                          重置到片段中点
                        </button>
                      </div>
                      <p className="text-[11px] text-white/30">
                        截取区间 {formatClock(clipStart)} –{" "}
                        {formatClock(clipStart + win)} · 播放器会在区间内循环，
                        拖动琥珀色游标选择 Key Photo
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 text-xs text-white/35">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      正在读取视频时长；超时也不影响直接生成
                    </div>
                  )}
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
                    <div>
                      <label className="mb-2.5 block text-sm text-white/70">
                        兼容转码编码（仅在源格式无法直封装时使用）
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
                  {jobPhase === "upload" && uploadProgress ? (
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-aurora-violet to-aurora-cyan transition-[width] duration-200"
                          style={{
                            width: `${uploadProgress.total > 0 ? Math.min(100, (uploadProgress.loaded / uploadProgress.total) * 100).toFixed(1) : 0}%`,
                          }}
                        />
                      </div>
                      <p className="mt-4 text-sm text-white/65">
                        正在上传视频…{(uploadProgress.loaded / 1048576).toFixed(1)} /{" "}
                        {(uploadProgress.total / 1048576).toFixed(1)} MB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-aurora-violet via-aurora-fuchsia to-aurora-cyan animate-shimmer"
                          style={{
                            backgroundSize: "200% 100%",
                            width: "100%",
                          }}
                        />
                      </div>
                      <p className="mt-4 text-sm text-white/65">
                        {jobPhase === "upload"
                          ? "正在上传视频…"
                          : "服务端转码封装中…"}
                      </p>
                    </div>
                  )}
                  <p className="mt-1.5 font-mono text-xs text-white/35">
                    已耗时 {elapsed}s
                    {jobPhase === "process" && " · 请勿切换到后台"}
                  </p>
                </div>
              </div>
            )}

            {step === "done" && realResult && (
              <div className="glass shadow-card rounded-3xl p-6 text-center sm:p-10">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15">
                  <Check className="h-7 w-7 text-emerald-300" />
                </span>
                <h2 className="font-display mt-4 text-2xl font-bold">
                  实况照片已生成
                </h2>

                <div className="mx-auto mt-6 max-w-md space-y-2.5 text-left">
                    <div className="overflow-hidden rounded-2xl border border-white/10">
                      <img
                        src={realResult.still_url}
                        alt="实况封面"
                        className="block w-full"
                      />
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-white/55">处理方式</span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-medium",
                            realResult.meta.video_action === "copy"
                              ? "bg-emerald-400/15 text-emerald-200"
                              : "bg-amber-300/15 text-amber-200",
                          )}
                        >
                          {realResult.meta.video_action !== "copy"
                            ? "兼容转码"
                            : realResult.meta.no_reencode
                              ? "视频 / 音频均未重编码"
                              : realResult.meta.audio_action === "reencode"
                                ? "视频原画质 · 音频转 AAC"
                                : "视频原画质流复制"}
                        </span>
                      </div>
                      <div className="mt-2.5 flex justify-between gap-4">
                        <span className="text-white/40">导出时长</span>
                        <span className="font-mono text-white">
                          {realResult.meta.output_duration.toFixed(2)}s
                        </span>
                      </div>
                      <div className="mt-1.5 flex justify-between gap-4">
                        <span className="text-white/40">封面帧</span>
                        <span className="text-right font-mono text-amber-200">
                          原片 {realResult.meta.keyframe_time.toFixed(2)}s · 片段内{" "}
                          {realResult.meta.keyframe_offset.toFixed(2)}s
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
                      <div className="mt-2.5 border-t border-white/10 pt-2.5">
                        <p className="break-all font-mono text-[11px] text-white/65">
                          {realResult.meta.file_base_name}.JPG +{" "}
                          {realResult.meta.file_base_name}.MOV
                        </p>
                        <p className="mt-1 text-[11px] text-white/35">
                          同名配对 · 请在系统面板中同时保存两个项目
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-3.5">
                      <p className="text-[11px] tracking-wider text-white/35">
                        元数据校验通过 · JPG / MOV 标识严格匹配
                      </p>
                      <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-white/60">
                        {realResult.meta.content_identifier}
                      </p>
                    </div>
                    {realResult.meta.warnings.length > 0 && (
                      <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-200">
                        {realResult.meta.warnings.join(" ")}
                      </p>
                    )}
                    {shareNotice && (
                      <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-center text-xs leading-relaxed text-white/65">
                        {shareNotice}
                      </p>
                    )}

                    <div className="space-y-3 pt-2">
                      <WeChatTip />
                      {shareState === "loading" ? (
                        <div className="space-y-2.5">
                          <button
                            disabled
                            className="btn-primary flex w-full items-center justify-center gap-2 opacity-70"
                          >
                            <Loader2 className="h-4 w-4 animate-spin" />
                            正在准备相册文件…
                          </button>
                          {shareProgress && (
                            <div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-aurora-violet to-aurora-cyan transition-[width] duration-200"
                                  style={{
                                    width:
                                      shareProgress.total != null &&
                                      shareProgress.total > 0
                                        ? `${Math.min(100, (shareProgress.loaded / shareProgress.total) * 100).toFixed(1)}%`
                                        : "100%",
                                  }}
                                />
                              </div>
                              <p className="mt-1.5 text-center text-[11px] text-white/40">
                                {shareProgress.total != null &&
                                shareProgress.total > 0
                                  ? `已下载 ${(shareProgress.loaded / 1048576).toFixed(1)} / ${(shareProgress.total / 1048576).toFixed(1)} MB（${Math.min(100, (shareProgress.loaded / shareProgress.total) * 100).toFixed(0)}%）`
                                  : `已下载 ${(shareProgress.loaded / 1048576).toFixed(1)} MB…`}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={saveToPhotos}
                          className="btn-primary flex w-full items-center justify-center gap-2 !py-4"
                        >
                          <Share2 className="h-5 w-5" />
                          直接存入相册
                        </button>
                      )}
                      {shareState === "error" && shareError && (
                        <p className="mt-2 text-center text-[11px] text-amber-200/80">
                          {shareError}，请使用 ZIP。
                        </p>
                      )}
                      {shareState !== "loading" && (
                        <p className="mt-2 text-center text-[11px] leading-relaxed text-white/35">
                          {shareSupported
                            ? "点击后在 iOS 系统面板选择「存储 2 个项目」，无需解压"
                            : typeof window !== "undefined" &&
                                !window.isSecureContext
                              ? "直存需要 HTTPS；当前地址只能使用 ZIP 兜底"
                              : "当前浏览器不支持多文件分享；请使用 ZIP 兜底"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                      <a
                        href={realResult.download_url}
                        download
                        className="btn-ghost"
                      >
                        <Download className="h-4 w-4" />
                        下载 ZIP 兜底
                      </a>
                      <button onClick={reset} className="btn-ghost">
                        <RotateCcw className="h-4 w-4" />
                        再做一个
                      </button>
                    </div>
                </div>
              </div>
            )}
        </motion.div>
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
