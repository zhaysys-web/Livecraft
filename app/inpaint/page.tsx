"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Download,
  RotateCcw,
  Wand2,
  Zap,
  Sparkles,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Dropzone } from "@/components/tools/dropzone";
import {
  BrushCanvas,
  type BrushCanvasHandle,
} from "@/components/tools/brush-canvas";
import { BeforeAfter } from "@/components/tools/before-after";
import {
  MobileActionBar,
  type BarAction,
} from "@/components/tools/mobile-action-bar";
import { ServiceStatusPill } from "@/components/tools/service-status";
import { useMediaService } from "@/hooks/use-media-service";
import { inpaintImage } from "@/lib/media-client";
import { downloadDataUrl } from "@/lib/download";
import { cn } from "@/lib/utils";

type AiMethod = "telea" | "ns";

export default function InpaintPage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // AI 高精度修复状态
  const [aiMethod, setAiMethod] = useState<AiMethod>("telea");
  const [aiWorking, setAiWorking] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const brushRef = useRef<BrushCanvasHandle>(null);
  const aiRunning = useRef(false);

  const serviceStatus = useMediaService();
  const online = serviceStatus === "online";

  useEffect(() => {
    const url = imageUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [imageUrl]);

  useEffect(() => {
    const url = aiResult;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [aiResult]);

  const handleFiles = (files: File[]) => {
    const f = files[0];
    if (!f) {
      setImageFile(null);
      setImageUrl(null);
      return;
    }
    setImageFile(f);
    setImageUrl(URL.createObjectURL(f));
    setResult(null);
    setAiResult(null);
    setAiError(null);
  };

  const resetImage = () => {
    setImageFile(null);
    setImageUrl(null);
    setResult(null);
    setAiResult(null);
    setAiError(null);
  };

  /** AI 高精度修复：掩膜 + 原图发往 media-service */
  const runAi = async () => {
    if (aiRunning.current || !imageFile) return;
    aiRunning.current = true;
    setAiWorking(true);
    setAiError(null);
    try {
      const maskBlob = await brushRef.current?.getMaskBlob();
      if (!maskBlob) {
        setAiError("请先用画笔涂抹水印区域");
        return;
      }
      const blob = await inpaintImage(
        imageFile,
        new File([maskBlob], "mask.png", { type: "image/png" }),
        aiMethod,
      );
      setAiResult(URL.createObjectURL(blob));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 修复失败，请重试");
    } finally {
      setAiWorking(false);
      aiRunning.current = false;
    }
  };

  const download = (url: string | null, name: string) => {
    if (url) downloadDataUrl(url, name);
  };

  const actions: BarAction[] = [];
  if (imageUrl && !result && !aiResult) {
    actions.push({
      label: "本地快速擦除",
      onClick: () => brushRef.current?.run(),
    });
    actions.push({
      label: aiWorking ? "AI 修复中…" : "AI 高精度修复",
      primary: true,
      disabled: !online || aiWorking,
      onClick: runAi,
    });
  } else if (aiResult) {
    actions.push({
      label: "下载 PNG",
      primary: true,
      onClick: () => download(aiResult, "livecraft-inpaint-ai.png"),
    });
  } else if (result) {
    actions.push({
      label: "下载 PNG",
      primary: true,
      onClick: () => download(result, "livecraft-inpaint.png"),
    });
  }

  const showResult = aiResult ?? result;

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
          去水印橡皮擦
          <span className="ml-3 text-base font-normal text-white/35">
            Inpaint Eraser
          </span>
        </h1>
        <ServiceStatusPill />
      </div>
      <p className="mt-3 text-sm text-white/45">
        上传图片，用画笔涂抹水印区域。本地快速擦除即时可用
        {online ? "；媒体服务已连接，可选用 AI 高精度修复。" : "；连接媒体服务后可选用 AI 高精度修复。"}
      </p>

      <div className="mt-8">
        {!imageUrl ? (
          <Dropzone
            accept="image/*"
            maxSizeMB={20}
            hint="支持 JPG / PNG / WebP · 最大 20MB"
            onFiles={handleFiles}
          />
        ) : (
          <AnimatePresence mode="wait">
            {!showResult ? (
              <motion.div
                key="edit"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
              >
                <BrushCanvas
                  ref={brushRef}
                  imageUrl={imageUrl}
                  onResult={setResult}
                />

                {/* AI 修复控制区 */}
                <div className="glass mx-auto mt-4 max-w-[720px] rounded-2xl p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="h-4 w-4 text-aurora-fuchsia" />
                      <span className="text-sm font-medium text-white">
                        AI 高精度修复
                      </span>
                      <span className="text-[11px] text-white/35">
                        OpenCV {aiMethod === "telea" ? "TELEA" : "NS"} · 适合大面积水印
                      </span>
                    </div>
                    <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-1">
                      {(["telea", "ns"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setAiMethod(m)}
                          disabled={!online}
                          className={cn(
                            "rounded-full px-3.5 py-1.5 font-mono text-xs transition-all",
                            aiMethod === m
                              ? "bg-white text-black"
                              : "text-white/50 hover:text-white",
                            !online && "opacity-40",
                          )}
                        >
                          {m.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {aiError && (
                    <p className="mt-3 flex items-start gap-2 text-xs text-amber-300/90">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {aiError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                    <button
                      onClick={runAi}
                      disabled={!online || aiWorking}
                      title={online ? "" : "需连接媒体服务"}
                      className="btn-primary flex-1 disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none"
                    >
                      {aiWorking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {aiWorking ? "AI 修复中…" : "AI 高精度修复"}
                    </button>
                    <button
                      onClick={() => brushRef.current?.run()}
                      className="btn-ghost flex-1"
                    >
                      <Zap className="h-4 w-4" />
                      本地快速擦除
                    </button>
                  </div>
                  {!online && (
                    <p className="mt-2.5 text-center text-[11px] text-white/35">
                      媒体服务未连接，AI 修复不可用；本地快速擦除不受影响
                    </p>
                  )}
                </div>

                <div className="mt-4 hidden justify-end md:flex">
                  <button
                    onClick={resetImage}
                    className="btn-ghost !px-5 !py-2.5 !text-[13px]"
                  >
                    <RotateCcw className="h-4 w-4" />
                    换一张图
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="mx-auto max-w-[720px]"
              >
                <div className="mb-4 flex items-center gap-2.5">
                  {aiResult ? (
                    <span className="chip !border-aurora-fuchsia/30 !bg-aurora-fuchsia/[0.08] !text-aurora-fuchsia">
                      <Sparkles className="h-3.5 w-3.5" />
                      AI 高精度修复 · {aiMethod.toUpperCase()}
                    </span>
                  ) : (
                    <span className="chip">
                      <Zap className="h-3.5 w-3.5" />
                      本地快速擦除
                    </span>
                  )}
                </div>
                <BeforeAfter before={imageUrl} after={showResult} />
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    onClick={() =>
                      download(
                        showResult,
                        aiResult
                          ? "livecraft-inpaint-ai.png"
                          : "livecraft-inpaint.png",
                      )
                    }
                    className="btn-primary"
                  >
                    <Download className="h-4 w-4" />
                    下载 PNG
                  </button>
                  <button
                    onClick={() => {
                      setResult(null);
                      setAiResult(null);
                    }}
                    className="btn-ghost"
                  >
                    <Wand2 className="h-4 w-4" />
                    返回继续涂抹
                  </button>
                  <button onClick={resetImage} className="btn-ghost">
                    <RotateCcw className="h-4 w-4" />
                    换一张图
                  </button>
                </div>
                <p className="mt-4 text-center text-xs text-white/35">
                  拖动中间手柄，对比擦除前后效果
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {actions.length > 0 && <MobileActionBar actions={actions} />}
    </div>
  );
}
