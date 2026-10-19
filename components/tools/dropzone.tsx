"use client";

import { useRef, useState } from "react";
import { UploadCloud, X, FileVideo, FileImage, AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/download";

interface DropzoneProps {
  accept: "video/*" | "image/*";
  maxSizeMB: number;
  multiple?: boolean;
  hint?: string;
  onFiles: (files: File[]) => void;
}

/**
 * 万能拖拽上传：拖拽高亮 + 呼吸脉冲 + 即时格式/大小校验
 */
export function Dropzone({
  accept,
  maxSizeMB,
  multiple = false,
  hint,
  onFiles,
}: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const errorTimer = useRef<number | null>(null);

  const isVideo = accept.startsWith("video");
  const Icon = isVideo ? FileVideo : FileImage;

  const showError = (msg: string) => {
    setError(msg);
    if (errorTimer.current) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setError(null), 3200);
  };

  const validate = (f: File): string | null => {
    const okType = isVideo ? f.type.startsWith("video/") : f.type.startsWith("image/");
    if (!okType) return `仅支持${isVideo ? "视频" : "图片"}文件`;
    if (f.size > maxSizeMB * 1024 * 1024)
      return `文件超过 ${maxSizeMB}MB 限制`;
    return null;
  };

  const ingest = (incoming: File[]) => {
    const next: File[] = multiple ? [...files] : [];
    for (const f of incoming) {
      const err = validate(f);
      if (err) {
        showError(`${f.name}：${err}`);
        continue;
      }
      if (multiple) next.push(f);
      else {
        next.length = 0;
        next.push(f);
        break;
      }
    }
    if (next.length > 0) {
      setFiles(next);
      onFiles(next);
    }
  };

  const removeFile = (idx: number) => {
    const next = files.filter((_, i) => i !== idx);
    setFiles(next);
    onFiles(next);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="上传文件"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current--;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          ingest(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "glass group relative cursor-pointer rounded-3xl border-dashed px-6 py-14 text-center outline-none transition-all duration-300",
          dragging
            ? "scale-[1.01] border-aurora-violet/60 bg-aurora-violet/[0.07] shadow-glow-violet animate-pulse-ring"
            : "border-white/15 hover:border-white/30 hover:bg-white/[0.05]",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) ingest(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        <span
          className={cn(
            "mx-auto grid h-16 w-16 place-items-center rounded-2xl transition-all duration-300",
            dragging
              ? "bg-gradient-to-br from-aurora-violet to-aurora-cyan shadow-glow-violet"
              : "bg-white/[0.06] group-hover:bg-white/[0.09]",
          )}
        >
          <UploadCloud
            className={cn(
              "h-7 w-7 transition-colors",
              dragging ? "text-white" : "text-white/60",
            )}
          />
        </span>

        <p className="mt-5 text-[15px] font-medium text-white">
          {dragging ? "松开鼠标，开始上传" : "拖拽文件到这里，或点击选择"}
        </p>
        <p className="mt-2 text-xs text-white/40">
          {hint ?? `支持${isVideo ? "视频" : "图片"}格式 · 最大 ${maxSizeMB}MB`}
        </p>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute inset-x-6 bottom-4 flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="glass flex items-center gap-3 rounded-2xl px-4 py-3"
            >
              <Icon className="h-5 w-5 shrink-0 text-aurora-cyan" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">{f.name}</span>
                <span className="block text-xs text-white/40">
                  {formatBytes(f.size)}
                </span>
              </span>
              <button
                onClick={() => removeFile(i)}
                aria-label="移除文件"
                className="grid h-8 w-8 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
