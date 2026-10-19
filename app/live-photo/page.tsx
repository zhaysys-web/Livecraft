"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
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
  Sparkles,
  CheckCircle2,
  XCircle,
  HardDrive,
  Cpu,
} from "lucide-react";
import { Dropzone } from "@/components/tools/dropzone";
import { SegmentedControl } from "@/components/tools/segmented-control";
import { RangeTimeline } from "@/components/tools/range-timeline";
import {
  MobileActionBar,
  type BarAction,
} from "@/components/tools/mobile-action-bar";
import { ServiceStatusPill } from "@/components/tools/service-status";
import { WeChatTip, isWeChatBrowser } from "@/components/tools/wechat-tip";
import { useMediaService } from "@/hooks/use-media-service";
import {
  deleteLivePhotoJob,
  livePhotoConvert,
  type LivePhotoResult,
  type LivePhotoParams,
} from "@/lib/media-client";
import {
  createLocalLivePhoto,
  type LocalLivePhotoOutput,
} from "@/lib/local-livephoto";
import {
  DURATION_MODES,
  FALLBACKS,
  effectiveWindow,
  formatClock,
  newContentIdentifier,
  type DurationMode,
  type FallbackStrategy,
  type VideoCodec,
} from "@/lib/livephoto";
import { cn } from "@/lib/utils";

/** 9 大标准生命周期状态 */
export type StudioState =
  | "idle"        // 等待选择视频或已选视频待配置
  | "validating"  // 检查视频格式、尺寸与时长
  | "converting"  // 抽取关键帧与图像处理（本地或云端开始）
  | "packaging"   // 写入 Apple EXIF / QuickTime 原子并校验配对
  | "ready"       // 生成完毕，等待用户保存
  | "saving"      // 正在唤起系统相册面板或执行保存
  | "success"     // 用户确认已保存至相册
  | "error"       // 转换或保存失败
  | "cancelled";  // 用户取消了系统分享/保存

/** 生成产物结构 */
interface LivePhotoArtifact {
  source: "local" | "cloud";
  stillUrl: string;
  movUrl: string;
  zipUrl: string;
  stillFile?: File;
  movFile?: File;
  contentIdentifier: string;
  fileBaseName: string;
  outputDuration: number;
  stillTime: number;
  videoAction: "copy" | "reencode";
  audioAction: "copy" | "reencode" | "none";
  warnings: string[];
  revoke?: () => void;
  jobId?: string;
  localOutput?: LocalLivePhotoOutput;
}

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

/** 结构化阶段日志记录函数（保护用户隐私，不记录视频文件名与内容） */
function logStage(
  taskId: string,
  stage: StudioState | string,
  elapsedMs: number,
  detail?: string,
  meta?: Record<string, unknown>,
) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.info(`[LiveCraft Task:${taskId}] stage=${stage} elapsed=${elapsedMs}ms`, {
      detail: detail ?? "",
      timestamp: new Date().toISOString(),
      ...meta,
    });
  }
}

export default function LivePhotoPage() {
  // 状态机核心状态
  const [state, setState] = useState<StudioState>("idle");
  const [subStageMsg, setSubStageMsg] = useState<string>("");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  // 用户所选视频
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [canLocalTransform, setCanLocalTransform] = useState(true);

  // 转换参数
  const [durationMode, setDurationMode] = useState<DurationMode>(3);
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [muted, setMuted] = useState(true);
  const [fallback, setFallback] = useState<FallbackStrategy>("pingpong");
  const [preferCloud, setPreferCloud] = useState(false);

  // 时间轴与封面帧
  const [videoDuration, setVideoDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [keyframe, setKeyframe] = useState(0);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // 最终生成产物与诊断信息
  const [artifact, setArtifact] = useState<LivePhotoArtifact | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [shareSupported, setShareSupported] = useState(false);
  const [shareFiles, setShareFiles] = useState<File[]>([]);

  // 计时与任务标记
  const [elapsed, setElapsed] = useState(0);
  const taskIdRef = useRef<string>("");
  const isJobRunning = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const serviceStatus = useMediaService();
  const online = serviceStatus === "online";
  const win = effectiveWindow(videoDuration, durationMode);

  // 及时释放对象 URL，防止 iPhone Safari 内存溢出
  useEffect(() => {
    const url = videoUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [videoUrl]);

  // 处理中定时记录已耗时
  useEffect(() => {
    if (state === "converting" || state === "packaging" || state === "saving") {
      const timer = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => window.clearInterval(timer);
    }
  }, [state]);

  /** 选择或拖入新视频 */
  const handleFiles = (files: File[]) => {
    const file = files[0];
    if (!file) {
      reset();
      return;
    }

    // 重置已有状态
    if (artifact?.revoke) artifact.revoke();
    setArtifact(null);
    setErrorMessage(null);
    setNoticeMessage(null);
    setShareFiles([]);
    setShareSupported(false);

    const taskId = `task_${Date.now().toString(36)}`;
    taskIdRef.current = taskId;

    setState("validating");
    setSubStageMsg("正在检查视频格式与参数…");
    logStage(taskId, "validating", 0, "开始校验用户输入文件", {
      fileSizeMB: (file.size / 1048576).toFixed(2),
      mimeType: file.type,
    });

    if (file.size > 200 * 1024 * 1024) {
      setState("error");
      setErrorMessage("视频文件超过 200MB 上限，请选择较小的视频剪辑。");
      logStage(taskId, "error", 0, "文件体积超过上限");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isMovOrMp4 = ext === "mov" || ext === "mp4" || file.type.includes("mp4") || file.type.includes("quicktime");
    setCanLocalTransform(isMovOrMp4);

    setVideoFile(file);
    const objUrl = URL.createObjectURL(file);
    setVideoUrl(objUrl);
    setVideoName(file.name);
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);

    // 校验完毕进入就绪配置态
    setState("idle");
    setSubStageMsg("");
  };

  /** 视频元数据就绪：设置裁剪区间与中点封面 */
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
    const initialKey = Math.round((effectiveWindow(d, durationMode) / 2) * 100) / 100;
    setKeyframe(initialKey);
    try {
      v.currentTime = 0;
      void v.play().catch(() => {});
    } catch {
      // 忽略自动播放限制
    }
  };

  /** 切换 3s / 5s 时长模式 */
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

  /** 拖动裁剪窗口 */
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
        // ignore seek error
      }
    }
  };

  /** 选择封面帧 */
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
      // ignore
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
        // ignore
      }
    }
  };

  /** 构建云端备用请求参数 */
  const buildCloudParams = (): LivePhotoParams => ({
    durationMode,
    clipStart: videoDuration > 0 ? clipStart : 0,
    keyframeTime: videoDuration > 0 ? keyframe : null,
    fallback,
    codec,
    muted,
    audioFadeSecs: 0.2,
    contentIdentifier: newContentIdentifier(),
  });

  /** 云端备用生成流程（带真实上传百分比） */
  const runCloudJob = async (file: File, taskId: string) => {
    logStage(taskId, "converting", 0, "开始云端转换降级流程");
    setSubStageMsg("正在向媒体服务上传视频 (0%)…");
    setUploadPercent(0);

    const onProgress = (pct: number, loaded: number, total: number) => {
      setUploadPercent(pct);
      const loadedMB = (loaded / 1048576).toFixed(1);
      const totalMB = (total / 1048576).toFixed(1);
      setSubStageMsg(`正在上传视频 ${pct}% (${loadedMB}MB / ${totalMB}MB)…`);
    };

    const cloudRes = await livePhotoConvert(file, buildCloudParams(), onProgress);

    setState("packaging");
    setSubStageMsg("服务端正在注入实况元数据并配对文件…");
    logStage(taskId, "packaging", 0, "服务端处理完毕，开始拉取文件");

    // 预取两个文件供 Web Share
    const [stillResp, movResp] = await Promise.all([
      fetch(cloudRes.still_url, { cache: "no-store" }),
      fetch(cloudRes.mov_url, { cache: "no-store" }),
    ]);

    if (!stillResp.ok || !movResp.ok) {
      throw new Error("云端生成文件暂时无法读取");
    }

    const [stillBlob, movBlob] = await Promise.all([
      stillResp.blob(),
      movResp.blob(),
    ]);

    const baseName = cloudRes.meta.file_base_name || `IMG_${cloudRes.job_id.toUpperCase()}`;
    const stillFile = new File([stillBlob], `${baseName}.JPG`, { type: "image/jpeg" });
    const movFile = new File([movBlob], `${baseName}.MOV`, { type: "video/quicktime" });
    const files = [stillFile, movFile];

    setShareFiles(files);
    setShareSupported(supportsFileShare(files));

    setArtifact({
      source: "cloud",
      stillUrl: cloudRes.still_url,
      movUrl: cloudRes.mov_url,
      zipUrl: cloudRes.download_url,
      stillFile,
      movFile,
      contentIdentifier: cloudRes.meta.content_identifier,
      fileBaseName: baseName,
      outputDuration: cloudRes.meta.output_duration,
      stillTime: cloudRes.meta.keyframe_time,
      videoAction: cloudRes.meta.video_action,
      audioAction: cloudRes.meta.audio_action,
      warnings: cloudRes.meta.warnings,
      jobId: cloudRes.job_id,
    });
  };

  /** 开始生成：优先本地转换，遇异常优雅降级云端 */
  const handleGenerate = async () => {
    if (isJobRunning.current || !videoFile) return;
    isJobRunning.current = true;

    const taskId = taskIdRef.current || `task_${Date.now().toString(36)}`;
    const startTime = performance.now();
    setElapsed(0);
    setErrorMessage(null);
    setNoticeMessage(null);
    setUploadPercent(null);

    try {
      // 检查是否可以使用纯前端本地转换：
      // 条件：视频格式为 MOV/MP4 容器，且未强制开启高级云端重编码/补齐模式
      const canTryLocal = canLocalTransform && !preferCloud;

      if (canTryLocal) {
        setState("converting");
        setSubStageMsg("本地秒级引擎正在提取高分辨率封面帧…");
        logStage(taskId, "converting", 0, "启动浏览器本地生成");

        try {
          const localOut = await createLocalLivePhoto(videoFile, {
            durationMode,
            clipStart,
            keyframeTime: videoDuration > 0 ? keyframe : null,
          });

          setState("packaging");
          setSubStageMsg("正在校验 Apple ContentIdentifier 元数据配对…");
          logStage(taskId, "packaging", Math.round(performance.now() - startTime), "本地注入与校验完成");

          const files = [localOut.stillFile, localOut.movFile];
          setShareFiles(files);
          setShareSupported(supportsFileShare(files));

          setArtifact({
            source: "local",
            stillUrl: localOut.stillUrl,
            movUrl: localOut.movUrl,
            zipUrl: localOut.zipUrl,
            stillFile: localOut.stillFile,
            movFile: localOut.movFile,
            contentIdentifier: localOut.contentIdentifier,
            fileBaseName: localOut.fileBaseName,
            outputDuration: durationMode,
            stillTime: localOut.stillTime,
            videoAction: "copy",
            audioAction: muted ? "none" : "copy",
            warnings: [],
            revoke: localOut.revoke,
            localOutput: localOut,
          });

          setState("ready");
          setSubStageMsg("");
          logStage(taskId, "ready", Math.round(performance.now() - startTime), "本地实况照片就绪");
          return;
        } catch (localErr) {
          // 本地转换失败，优雅降级至云端
          const msg = localErr instanceof Error ? localErr.message : String(localErr);
          logStage(taskId, "converting_fallback", Math.round(performance.now() - startTime), `本地转换失败，自动降级至云端: ${msg}`);
          setNoticeMessage("本地环境无法直封装该编码，已无缝切换至云端媒体服务进行高兼容封装。");
        }
      }

      // 降级云端模式
      setState("converting");
      await runCloudJob(videoFile, taskId);

      setState("ready");
      setSubStageMsg("");
      logStage(taskId, "ready", Math.round(performance.now() - startTime), "云端实况照片生成就绪");
    } catch (err) {
      setState("error");
      const errorText = err instanceof Error ? err.message : "生成实况照片失败，请检查视频后重试";
      setErrorMessage(errorText);
      logStage(taskId, "error", Math.round(performance.now() - startTime), errorText);
    } finally {
      isJobRunning.current = false;
    }
  };

  /** 一键存入相册（调用 iOS Safari 原生分享） */
  const handleSaveToPhotos = async () => {
    if (!artifact) return;

    if (isWeChatBrowser()) {
      setNoticeMessage(
        "检测到微信内置浏览器：微信环境不支持直接存入相册。请点击右上角「···」→「在浏览器打开」（如 Safari），即可一键保存为实况照片；或在下方直接下载 ZIP 兜底。",
      );
      return;
    }

    const nav = navigator as FileShareNavigator;
    const filesToShare = shareFiles.length === 2
      ? shareFiles
      : artifact.stillFile && artifact.movFile
        ? [artifact.stillFile, artifact.movFile]
        : [];

    if (filesToShare.length !== 2) {
      setNoticeMessage("相册文件尚未准备好，请稍候重试或使用 ZIP 兜底。");
      return;
    }

    if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
      setNoticeMessage("当前浏览器不支持原生文件分享，请在下方下载 ZIP 兜底包。");
      return;
    }

    if (!window.isSecureContext) {
      setNoticeMessage("一键存入相册需要 HTTPS 安全环境，局域网 HTTP 只能使用 ZIP 兜底。");
      return;
    }

    let canShare = false;
    try {
      canShare = nav.canShare({ files: filesToShare });
    } catch {
      canShare = false;
    }

    if (!canShare) {
      setNoticeMessage("当前系统未授予直接多文件保存权限，请使用 ZIP 兜底下载。");
      return;
    }

    // 状态流转至 saving
    setState("saving");
    setNoticeMessage("已唤起系统分享面板，请在弹窗菜单中点击「存储 2 个项目」即可合成为实况照片。");

    try {
      // 保持同步手势链触发
      await nav.share({
        files: filesToShare,
        title: "LiveCraft 实况照片",
      });

      // 用户已完成系统分享
      setState("success");
      setNoticeMessage("已成功唤起系统相册保存！请打开 iPhone「照片」App，长按刚刚保存的实况照片即可观看动效。");
      logStage(taskIdRef.current, "success", 0, "用户完成系统相册保存");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // 用户在系统面板点击了“取消”
        setState("cancelled");
        setNoticeMessage("已取消保存。实况照片文件依然就绪，你可以随时再次点击「保存实况照片」。");
        logStage(taskIdRef.current, "cancelled", 0, "用户取消系统分享面板");
        return;
      }
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setState("ready");
        setNoticeMessage("系统拦截了分享面板，请重新点击「保存实况照片」。");
        return;
      }
      setState("error");
      const msg = err instanceof Error ? err.message : "系统分享打开失败";
      setNoticeMessage(`保存未完成：${msg}。你可以重试或下载下方 ZIP 兜底。`);
      logStage(taskIdRef.current, "error", 0, msg);
    }
  };

  /** 重置并返回初始页面 */
  const reset = () => {
    if (artifact?.jobId) {
      void deleteLivePhotoJob(artifact.jobId).catch(() => {});
    }
    if (artifact?.revoke) {
      artifact.revoke();
    }
    setVideoFile(null);
    setVideoUrl(null);
    setVideoName("");
    setVideoDuration(0);
    setClipStart(0);
    setKeyframe(0);
    setDecodeError(null);
    setArtifact(null);
    setErrorMessage(null);
    setNoticeMessage(null);
    setShareFiles([]);
    setShareSupported(false);
    setUploadPercent(null);
    setState("idle");
    setSubStageMsg("");
    isJobRunning.current = false;
  };

  // 底部操作栏按钮配置
  const actions: BarAction[] = [];
  if (state === "idle" && videoFile) {
    actions.push({ label: "重新选择", onClick: () => reset() });
    actions.push({ label: "开始生成", primary: true, onClick: handleGenerate });
  } else if (
    state === "ready" ||
    state === "saving" ||
    state === "success" ||
    state === "cancelled"
  ) {
    actions.push({
      label: state === "saving" ? "正在保存…" : state === "success" ? "已存入相册 · 再次保存" : "保存实况照片",
      primary: true,
      disabled: state === "saving",
      onClick: handleSaveToPhotos,
    });
    actions.push({ label: "再做一个", onClick: reset });
  } else if (state === "error") {
    actions.push({ label: "重新开始", onClick: reset });
    if (videoFile) {
      actions.push({ label: "重试生成", primary: true, onClick: handleGenerate });
    }
  }

  const sizeMB = videoFile ? (videoFile.size / 1048576).toFixed(1) : "0";

  // 步骤条映射
  const stepIdx =
    state === "idle" && !videoFile
      ? 0
      : state === "converting" || state === "packaging"
        ? 1
        : state === "ready" || state === "saving" || state === "success" || state === "cancelled"
          ? 2
          : 1;

  const STEPS = [
    { label: "上传视频" },
    { label: "配置与生成" },
    { label: "保存实况照片" },
  ];

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

      {/* 微信内置浏览器提示 */}
      <div className="mt-4">
        <WeChatTip />
      </div>

      {/* 步骤条 */}
      <div className="mt-8 flex items-center">
        {STEPS.map((s, i) => (
          <div key={s.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-full text-xs font-semibold transition-all duration-300",
                  i < stepIdx
                    ? "bg-aurora-violet/25 text-aurora-violet"
                    : i === stepIdx
                      ? "bg-gradient-to-br from-aurora-violet to-aurora-cyan text-white shadow-glow-violet"
                      : "bg-white/[0.06] text-white/35",
                )}
              >
                {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm sm:block",
                  i <= stepIdx ? "text-white" : "text-white/35",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-3 h-px flex-1 transition-colors duration-300",
                  i < stepIdx ? "bg-aurora-violet/50" : "bg-white/10",
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* 主工作区 */}
      <div className="mt-8">
        <AnimatePresence mode="wait">
          {/* 状态 1: 未选视频，等待上传 */}
          {state === "idle" && !videoFile && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <Dropzone
                accept="video/*"
                maxSizeMB={200}
                hint="支持 iPhone 拍摄的 MOV / MP4 原画视频 · 优先浏览器本地秒级直转 · 最大 200MB"
                onFiles={handleFiles}
              />
            </motion.div>
          )}

          {/* 状态 2: 正在校验文件 */}
          {state === "validating" && (
            <motion.div
              key="validating"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass shadow-card rounded-3xl p-10 text-center"
            >
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-aurora-violet" />
              <p className="mt-4 text-base font-medium text-white">正在检查视频参数…</p>
              <p className="mt-1 text-xs text-white/40">{subStageMsg}</p>
            </motion.div>
          )}

          {/* 状态 3: 视频已载入，配置参数与时间轴裁剪 */}
          {state === "idle" && videoFile && (
            <motion.div
              key="ready-config"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-5"
            >
              {errorMessage && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3.5 text-sm text-red-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 文件信息卡片 */}
              <div className="glass shadow-card flex items-center gap-4 rounded-3xl p-5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-aurora-violet/25 to-aurora-cyan/25">
                  <Film className="h-6 w-6 text-white" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {videoName}
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    {sizeMB} MB · {canLocalTransform ? "支持浏览器本地秒级生成（无需上传）" : "特殊格式，自动启用云端高兼容转码"}
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="flex shrink-0 items-center gap-1.5 text-xs text-white/45 transition-colors hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  换一个
                </button>
              </div>

              {/* 转换模式标识 */}
              <div className="glass rounded-3xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-white/85">
                      处理引擎
                    </p>
                    <p className="mt-0.5 text-xs text-white/35">
                      {canLocalTransform && !preferCloud
                        ? "纯浏览器端硬件加速处理，零流量消耗，数据不出设备"
                        : "云端 FFmpeg 完整转码引擎，支持任意格式与高精度补齐"}
                    </p>
                  </div>
                  <span className={cn(
                    "chip",
                    canLocalTransform && !preferCloud
                      ? "!border-emerald-300/30 !bg-emerald-300/[0.08] !text-emerald-200"
                      : "!border-aurora-violet/30 !bg-aurora-violet/[0.08] !text-aurora-violet"
                  )}>
                    {canLocalTransform && !preferCloud ? (
                      <span className="flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5" /> 本地优先（极速秒出）
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" /> 云端 FFmpeg
                      </span>
                    )}
                  </span>
                </div>
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
                        "该视频无法在当前浏览器预览；不影响一键生成，后端仍可完成处理。",
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
                      {formatClock(clipStart + win)} · 拖动游标即可选择作为 iPhone 相册封面的 Key Photo
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 text-xs text-white/35">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在读取视频时长与首帧…
                  </div>
                )}
              </div>

              {/* 生成按钮 */}
              <button
                onClick={handleGenerate}
                disabled={isJobRunning.current}
                className="btn-primary w-full !py-4 !text-base"
              >
                <Sparkles className="mr-2 h-5 w-5" />
                开始生成实况照片
              </button>

              {/* 高级设置 */}
              <details className="group glass rounded-3xl">
                <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-white/70 transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                  高级与兼容设置
                  <ChevronDown className="h-4 w-4 text-white/40 transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <div className="space-y-5 border-t border-white/10 px-5 py-5">
                  {/* 强制使用云端 */}
                  <button
                    onClick={() => setPreferCloud((c) => !c)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/25"
                  >
                    <div className="text-left">
                      <span className="block text-sm font-semibold text-white">
                        强制使用云端 FFmpeg 转码
                      </span>
                      <span className="mt-0.5 block text-xs text-white/40">
                        当视频在手机浏览器偶发闪退或有特殊滤镜时推荐开启
                      </span>
                    </div>
                    <span
                      className={cn(
                        "relative h-6 w-11 rounded-full transition-colors duration-200",
                        preferCloud ? "bg-aurora-violet" : "bg-white/15",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200",
                          preferCloud ? "left-[22px]" : "left-0.5",
                        )}
                      />
                    </span>
                  </button>

                  {/* 静音设置 */}
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
                      {muted ? "静音导出（推荐，消除实况杂音）" : "保留视频原声"}
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
                      兼容转码编码（仅云端转码时生效）
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

                  <div>
                    <label className="mb-2.5 block text-sm text-white/70">
                      视频短于目标时长时的补齐方式（云端转码有效）
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
            </motion.div>
          )}

          {/* 状态 4 & 5: converting & packaging（真实耗时与明确阶段） */}
          {(state === "converting" || state === "packaging") && (
            <motion.div
              key="working"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass shadow-card rounded-3xl p-8 text-center sm:p-12"
            >
              <div className="relative mx-auto h-20 w-20">
                <div className="absolute inset-0 animate-breathe rounded-full bg-gradient-to-br from-aurora-violet/40 to-aurora-cyan/40 blur-xl" />
                <div className="glass-strong relative grid h-20 w-20 place-items-center rounded-full">
                  <Film className="h-8 w-8 text-white" />
                </div>
              </div>
              <div className="mx-auto mt-8 max-w-md">
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-aurora-violet via-aurora-fuchsia to-aurora-cyan animate-shimmer"
                    style={{
                      backgroundSize: "200% 100%",
                      width: uploadPercent != null ? `${uploadPercent}%` : "100%",
                    }}
                  />
                </div>
                <p className="mt-4 text-sm font-medium text-white/80">
                  {subStageMsg || (state === "converting" ? "正在处理视频流…" : "正在封装实况照片…")}
                </p>
                <p className="mt-1.5 font-mono text-xs text-white/35">
                  已耗时 {elapsed}s · {canLocalTransform && !preferCloud ? "浏览器硬件加速中" : "云端高精度转码中"}
                </p>
              </div>
            </motion.div>
          )}

          {/* 状态 6, 7, 8, 9: ready, saving, success, cancelled */}
          {(state === "ready" || state === "saving" || state === "success" || state === "cancelled") && artifact && (
            <motion.div
              key="done-workbench"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="glass shadow-card rounded-3xl p-6 text-center sm:p-10"
            >
              {/* 状态徽标 */}
              {state === "success" ? (
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
                  <CheckCircle2 className="h-8 w-8" />
                </span>
              ) : state === "cancelled" ? (
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-400/20 text-amber-300">
                  <AlertCircle className="h-8 w-8" />
                </span>
              ) : (
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
                  <Check className="h-7 w-7" />
                </span>
              )}

              <h2 className="font-display mt-4 text-2xl font-bold text-white">
                {state === "success"
                  ? "已调起系统相册保存"
                  : state === "cancelled"
                    ? "已取消本次保存"
                    : "实况照片制作完成"}
              </h2>

              <p className="mt-1 text-xs text-white/50">
                {state === "success"
                  ? "请在 iPhone 照片 App 中查看刚刚生成的实况照片"
                  : state === "cancelled"
                    ? "文件依然完好就绪，你可以随时再次保存"
                    : "元数据配对校验通过，可一键导入 iPhone 相册"}
              </p>

              {/* 结果详细面板 */}
              <div className="mx-auto mt-6 max-w-md space-y-3 text-left">
                {/* 封面预览 */}
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
                  <img
                    src={artifact.stillUrl}
                    alt="实况封面"
                    className="block max-h-[38vh] w-full object-contain"
                  />
                </div>

                {/* 元数据卡片 */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white/55">处理引擎</span>
                    <span className="chip !border-emerald-300/30 !bg-emerald-300/[0.08] !text-emerald-200">
                      {artifact.source === "local" ? "纯浏览器本地生成（零延迟）" : "云端 FFmpeg 原画质"}
                    </span>
                  </div>

                  <div className="mt-2.5 flex justify-between gap-4">
                    <span className="text-white/40">成片时长</span>
                    <span className="font-mono text-white">
                      {artifact.outputDuration.toFixed(2)}s
                    </span>
                  </div>

                  <div className="mt-1.5 flex justify-between gap-4">
                    <span className="text-white/40">封面时刻</span>
                    <span className="font-mono text-amber-200">
                      {artifact.stillTime.toFixed(2)}s
                    </span>
                  </div>

                  <div className="mt-2.5 border-t border-white/10 pt-2.5">
                    <p className="break-all font-mono text-[11px] text-white/65">
                      {artifact.fileBaseName}.JPG + {artifact.fileBaseName}.MOV
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      同名配对 · 系统识别后会自动在相册合成为 Live Photo
                    </p>
                  </div>
                </div>

                {/* UUID 配对信息 */}
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3.5">
                  <p className="text-[11px] tracking-wider text-emerald-300">
                    ✓ Apple ContentIdentifier 严格配对
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-white/60">
                    {artifact.contentIdentifier}
                  </p>
                </div>

                {/* 状态与提示通知 */}
                {noticeMessage && (
                  <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-3.5 text-center text-xs leading-relaxed text-white/80">
                    {noticeMessage}
                  </div>
                )}

                {/* 微信 UA 再次提示 */}
                <WeChatTip />

                {/* 一键存入相册核心交互 */}
                <div className="space-y-3 pt-2">
                  <button
                    onClick={handleSaveToPhotos}
                    disabled={state === "saving"}
                    className={cn(
                      "btn-primary flex w-full items-center justify-center gap-2 !py-4 !text-base",
                      state === "saving" && "opacity-75 cursor-not-allowed",
                    )}
                  >
                    {state === "saving" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        正在打开系统相册面板…
                      </>
                    ) : (
                      <>
                        <Share2 className="h-5 w-5" />
                        {state === "success" ? "再次存入相册" : "保存实况照片到相册"}
                      </>
                    )}
                  </button>

                  <p className="text-center text-[11px] leading-relaxed text-white/40">
                    {shareSupported
                      ? "点击后将在 iPhone 调起原生分享面板，请点击第一项「存储 2 个项目」即可合成为实况照片"
                      : typeof window !== "undefined" && !window.isSecureContext
                        ? "直接存入相册需要 HTTPS 安全协议；当前可使用下方 ZIP 兜底"
                        : "若当前系统未弹出多文件分享，请使用下方 ZIP 兜底"}
                  </p>
                </div>

                {/* 兜底下载栏 */}
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
                  <a
                    href={artifact.zipUrl}
                    download={`${artifact.fileBaseName}.zip`}
                    className="btn-ghost flex items-center justify-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    下载 ZIP 兜底文件
                  </a>
                  <button
                    onClick={reset}
                    className="btn-ghost flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    再做一个
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* 状态: error */}
          {state === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="glass shadow-card rounded-3xl p-8 text-center sm:p-10"
            >
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-500/15 text-red-400">
                <XCircle className="h-7 w-7" />
              </span>
              <h2 className="font-display mt-4 text-xl font-bold text-white">处理未完成</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-red-200/90">
                {errorMessage || "遇到未知错误，请重试或更换视频格式。"}
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button onClick={reset} className="btn-ghost">
                  重新选择视频
                </button>
                {videoFile && (
                  <button onClick={handleGenerate} className="btn-primary">
                    重新生成
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 桌面端操作栏 */}
      {actions.length > 0 && state !== "converting" && state !== "packaging" && state !== "validating" && (
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

      {/* 移动端操作栏 */}
      {state !== "converting" && state !== "packaging" && state !== "validating" && (
        <MobileActionBar actions={actions} />
      )}
    </div>
  );
}
