"use client";

import { useEffect, useState } from "react";
import { MessageCircleMore, X } from "lucide-react";

/** 是否在微信内置浏览器中 */
export function isWeChatBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /micromessenger/i.test(navigator.userAgent);
}

/**
 * 微信内置浏览器提示条。
 * 微信内无法直接调用系统分享存相册，必须先跳到系统浏览器。
 */
export function WeChatTip() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isWeChatBrowser());
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.06] px-4 py-3.5 text-left">
      <MessageCircleMore className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-emerald-200">
          检测到微信内置浏览器
        </p>
        <p className="mt-1 text-xs leading-relaxed text-white/55">
          请点击右上角 <span className="font-semibold text-white/85">···</span>{" "}
          →「在浏览器打开」，再点「直接存入相册」。微信内不支持直接保存实况照片到相册，ZIP
          兜底在微信内可正常下载。
        </p>
      </div>
      <button
        onClick={() => setShow(false)}
        aria-label="关闭提示"
        className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
