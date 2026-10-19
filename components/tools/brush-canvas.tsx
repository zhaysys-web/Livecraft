"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Brush,
  Eraser as EraserIcon,
  Undo2,
  Redo2,
  Trash2,
  Wand2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inpaintLite } from "@/lib/inpaint";

export interface BrushCanvasHandle {
  /** 触发一次擦除（供移动端悬浮栏调用） */
  run: () => void;
  /** 导出白底黑字掩膜 PNG（白=修复区），供后端 /api/inpaint 使用；无涂抹时返回 null */
  getMaskBlob: () => Promise<Blob | null>;
}

interface BrushCanvasProps {
  imageUrl: string;
  onResult: (dataUrl: string | null) => void;
}

const MAX_DIM = 1024;
const MAX_HISTORY = 25;

/**
 * 去水印 Canvas 画笔：
 * 笔刷 / 橡皮擦 / 粗细调节 / 撤销重做 / 本地轻量擦除
 */
export const BrushCanvas = forwardRef<BrushCanvasHandle, BrushCanvasProps>(
  function BrushCanvas({ imageUrl, onResult }, ref) {
    const baseRef = useRef<HTMLCanvasElement>(null);
    const maskRef = useRef<HTMLCanvasElement>(null);
    const [brushSize, setBrushSize] = useState(28);
    const [mode, setMode] = useState<"brush" | "eraser">("brush");
    const [working, setWorking] = useState(false);
    const [hasMask, setHasMask] = useState(false);
    const [version, setVersion] = useState(0);

    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);

    const bump = () => setVersion((v) => v + 1);

    // 载入图片：绘制到底层 canvas（工作分辨率 ≤1024），清空掩膜
    useEffect(() => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(
          1,
          MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight),
        );
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const base = baseRef.current!;
        const mask = maskRef.current!;
        base.width = w;
        base.height = h;
        mask.width = w;
        mask.height = h;
        base
          .getContext("2d", { willReadFrequently: true })!
          .drawImage(img, 0, 0, w, h);
        mask.getContext("2d")!.clearRect(0, 0, w, h);
        undoStack.current = [];
        redoStack.current = [];
        setHasMask(false);
        onResult(null);
        bump();
      };
      img.src = imageUrl;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imageUrl]);

    const detectMask = (): boolean => {
      const c = maskRef.current;
      if (!c) return false;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 16) {
        if (d[i] > 12) return true;
      }
      return false;
    };

    const snapshot = () => {
      undoStack.current.push(maskRef.current!.toDataURL());
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      bump();
    };

    const restore = (url: string) => {
      const img = new Image();
      img.onload = () => {
        const c = maskRef.current!;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        setHasMask(detectMask());
        bump();
      };
      img.src = url;
    };

    const undo = () => {
      const prev = undoStack.current.pop();
      if (!prev) return;
      redoStack.current.push(maskRef.current!.toDataURL());
      restore(prev);
    };

    const redo = () => {
      const next = redoStack.current.pop();
      if (!next) return;
      undoStack.current.push(maskRef.current!.toDataURL());
      restore(next);
    };

    const clearMask = () => {
      snapshot();
      const c = maskRef.current!;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setHasMask(false);
    };

    const toCanvasPos = (e: React.PointerEvent) => {
      const c = maskRef.current!;
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const sy = c.height / rect.height;
      return {
        x: (e.clientX - rect.left) * sx,
        y: (e.clientY - rect.top) * sy,
      };
    };

    const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const ctx = maskRef.current!.getContext("2d")!;
      ctx.save();
      if (mode === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(244,63,94,0.6)";
      }
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    };

    const runInpaint = () => {
      if (working || !hasMask) return;
      setWorking(true);
      // 让 loading 状态先渲染一帧，避免长计算阻塞 UI 反馈
      window.setTimeout(() => {
        try {
          const result = inpaintLite(baseRef.current!, maskRef.current!);
          onResult(result.toDataURL("image/png"));
        } catch {
          onResult(null);
        } finally {
          setWorking(false);
        }
      }, 60);
    };

    /** 导出白底黑字掩膜 PNG（白=修复区），供后端 /api/inpaint 使用 */
    const getMaskBlob = (): Promise<Blob | null> => {
      return new Promise((resolve) => {
        if (!detectMask()) {
          resolve(null);
          return;
        }
        const src = maskRef.current!;
        // 白色修复区：以原掩膜 alpha 为蒙版抠出
        const white = document.createElement("canvas");
        white.width = src.width;
        white.height = src.height;
        const wctx = white.getContext("2d")!;
        wctx.fillStyle = "#fff";
        wctx.fillRect(0, 0, white.width, white.height);
        wctx.globalCompositeOperation = "destination-in";
        wctx.drawImage(src, 0, 0);
        // 衬黑底
        const out = document.createElement("canvas");
        out.width = src.width;
        out.height = src.height;
        const octx = out.getContext("2d")!;
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(white, 0, 0);
        out.toBlob((b) => resolve(b), "image/png");
      });
    };

    useImperativeHandle(ref, () => ({ run: runInpaint, getMaskBlob }));

    const pct = ((brushSize - 4) / (80 - 4)) * 100;

    return (
      <div className="glass shadow-card rounded-3xl p-5 sm:p-6">
        {/* 画布区 */}
        <div className="mx-auto max-w-[720px]">
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
            <canvas ref={baseRef} className="block h-auto w-full" />
            <canvas
              ref={maskRef}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                snapshot();
                drawing.current = true;
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                const p = toCanvasPos(e);
                last.current = p;
                stroke(p, p);
              }}
              onPointerMove={(e) => {
                if (!drawing.current || !last.current) return;
                const p = toCanvasPos(e);
                stroke(last.current, p);
                last.current = p;
              }}
              onPointerUp={() => {
                drawing.current = false;
                last.current = null;
                setHasMask(detectMask());
              }}
              onPointerCancel={() => {
                drawing.current = false;
                last.current = null;
              }}
            />
            {working && (
              <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-aurora-violet" />
                  <p className="text-sm text-white/70">正在擦除水印…</p>
                </div>
              </div>
            )}
          </div>
          <p className="mt-2.5 text-center text-xs text-white/35">
            在图片上涂抹水印区域，红色即待擦除部分
          </p>
        </div>

        {/* 工具栏 */}
        <div className="mx-auto mt-5 flex max-w-[720px] flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-1">
            <button
              onClick={() => setMode("brush")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm transition-all",
                mode === "brush"
                  ? "bg-white text-black"
                  : "text-white/55 hover:text-white",
              )}
            >
              <Brush className="h-4 w-4" />
              画笔
            </button>
            <button
              onClick={() => setMode("eraser")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm transition-all",
                mode === "eraser"
                  ? "bg-white text-black"
                  : "text-white/55 hover:text-white",
              )}
            >
              <EraserIcon className="h-4 w-4" />
              橡皮擦
            </button>
          </div>

          <div className="flex min-w-[160px] flex-1 items-center gap-3">
            <span className="shrink-0 text-xs text-white/45">粗细</span>
            <input
              type="range"
              min={4}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="slider flex-1"
              style={{ "--fill": `${pct}%` } as CSSProperties}
              aria-label="笔刷粗细"
            />
            <span className="w-8 shrink-0 font-mono text-xs text-white/55">
              {brushSize}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={undoStack.current.length === 0}
              aria-label="撤销"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/60 transition-all hover:border-white/25 hover:text-white disabled:opacity-30"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={redoStack.current.length === 0}
              aria-label="重做"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/60 transition-all hover:border-white/25 hover:text-white disabled:opacity-30"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              onClick={clearMask}
              disabled={!hasMask}
              aria-label="清空涂抹"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/60 transition-all hover:border-red-400/40 hover:text-red-300 disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          onClick={runInpaint}
          disabled={!hasMask || working}
          className="btn-primary mt-5 w-full disabled:opacity-40 disabled:hover:scale-100 disabled:hover:shadow-none sm:w-auto"
        >
          {working ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          {working ? "擦除中…" : "开始擦除（本地轻量修复）"}
        </button>
        <p className="mt-2.5 text-xs text-white/35" key={version}>
          本地原型算法适合纯色 / 简单纹理背景；复杂场景的高精度 AI 修复将在阶段三接入。
        </p>
      </div>
    );
  },
);
