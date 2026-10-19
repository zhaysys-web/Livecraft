/**
 * 轻量版内容感知填充（原型级算法）
 *
 * 从掩膜边缘逐层向内传播已知像素，适合小面积水印 / 文字擦除。
 * 高精度场景由阶段三的 LaMa / Stable Diffusion Inpainting 接管。
 *
 * @param source 已绘制原图的 canvas
 * @param mask   掩膜 canvas（alpha > 12 的像素视为待修复区域）
 * @returns 修复后的新 canvas（与 source 同尺寸）
 */
export function inpaintLite(
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const sCtx = source.getContext("2d", { willReadFrequently: true });
  const mCtx = mask.getContext("2d", { willReadFrequently: true });
  if (!sCtx || !mCtx) throw new Error("Canvas 2D context unavailable");

  const src = sCtx.getImageData(0, 0, w, h);
  const msk = mCtx.getImageData(0, 0, w, h);
  const d = src.data;
  const n = w * h;

  const isHole = new Uint8Array(n);
  const known = new Uint8Array(n);
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (msk.data[i * 4 + 3] > 12) {
      isHole[i] = 1;
      holes++;
    } else {
      known[i] = 1;
    }
  }

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const oCtx = out.getContext("2d")!;

  // 无掩膜：原样返回
  if (holes === 0) {
    oCtx.putImageData(src, 0, 0);
    return out;
  }

  const fillR = new Float32Array(n);
  const fillG = new Float32Array(n);
  const fillB = new Float32Array(n);
  const toFill = new Uint8Array(n);

  let remaining = holes;
  let iter = 0;
  const MAX_ITER = 600;

  // 洋葱剥皮：每轮填充与已知区域相邻的一圈掩膜像素
  while (remaining > 0 && iter < MAX_ITER) {
    iter++;
    toFill.fill(0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!isHole[i] || known[i]) continue;
        let r = 0,
          g = 0,
          b = 0,
          c = 0;
        if (x > 0 && known[i - 1]) {
          const j = (i - 1) * 4;
          r += d[j];
          g += d[j + 1];
          b += d[j + 2];
          c++;
        }
        if (x < w - 1 && known[i + 1]) {
          const j = (i + 1) * 4;
          r += d[j];
          g += d[j + 1];
          b += d[j + 2];
          c++;
        }
        if (y > 0 && known[i - w]) {
          const j = (i - w) * 4;
          r += d[j];
          g += d[j + 1];
          b += d[j + 2];
          c++;
        }
        if (y < h - 1 && known[i + w]) {
          const j = (i + w) * 4;
          r += d[j];
          g += d[j + 1];
          b += d[j + 2];
          c++;
        }
        if (c > 0) {
          fillR[i] = r / c;
          fillG[i] = g / c;
          fillB[i] = b / c;
          toFill[i] = 1;
        }
      }
    }

    let filledThisRound = 0;
    for (let i = 0; i < n; i++) {
      if (toFill[i]) {
        const j = i * 4;
        d[j] = fillR[i];
        d[j + 1] = fillG[i];
        d[j + 2] = fillB[i];
        known[i] = 1;
        filledThisRound++;
      }
    }
    // 孤立掩膜（周围无已知像素）：停止，避免死循环
    if (filledThisRound === 0) break;
    remaining -= filledThisRound;
  }

  oCtx.putImageData(src, 0, 0);
  return out;
}
