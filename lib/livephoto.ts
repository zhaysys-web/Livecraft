/**
 * Live Photo 任务参数模型
 * 前端采集 → 阶段三后端（FastAPI + FFmpeg / ExifTool）消费。
 * buildFfmpegArgs 是给后端移植为 Python 时的参考实现。
 */

export type DurationMode = 3 | 5;
export type FallbackStrategy = "pingpong" | "slowdown" | "keep";
export type VideoCodec = "h264" | "hevc";

export interface LivePhotoJobParams {
  durationMode: DurationMode;
  /** 裁剪窗口起始（秒，相对原视频） */
  clipStart: number;
  /** 封面帧时间戳（秒，相对原视频）→ 写入 still-image-time */
  keyframeTime: number;
  /** 原视频短于目标时长时的兜底策略 */
  fallback: FallbackStrategy;
  codec: VideoCodec;
  muted: boolean;
  /** 裁剪片段首尾音频淡入淡出（秒），防爆音 */
  audioFadeSecs: number;
  /** 目标帧率上限；后端用 ffprobe 读取源帧率后取 min(源, 60) */
  targetFps: number;
  /** UUID：静态图与视频的元数据严格匹配 */
  contentIdentifier: string;
  videoDuration: number;
}

export const DURATION_MODES: {
  value: DurationMode;
  label: string;
  sub: string;
}[] = [
  { value: 3, label: "3 秒", sub: "原生锁屏 / 全平台最佳兼容" },
  { value: 5, label: "5 秒", sub: "适合相册展示 / 小红书等社交平台" },
];

export const FALLBACKS: {
  value: FallbackStrategy;
  label: string;
  en: string;
  desc: string;
}[] = [
  {
    value: "pingpong",
    label: "正倒放循环",
    en: "Ping-Pong",
    desc: "正放 + 倒放拼接补齐至目标时长，动作连贯不断",
  },
  {
    value: "slowdown",
    label: "变速慢放",
    en: "Slow-down",
    desc: "平滑降速拉伸至目标时长",
  },
  {
    value: "keep",
    label: "保持原长",
    en: "Keep",
    desc: "不强制拉伸，按原视频最大时长导出",
  },
];

export const FALLBACK_LABEL: Record<FallbackStrategy, string> = {
  pingpong: "正倒放循环",
  slowdown: "变速慢放",
  keep: "保持原长",
};

/** 原视频是否短于目标时长（需要兜底） */
export function needsFallback(
  videoDuration: number,
  mode: DurationMode,
): boolean {
  return videoDuration > 0 && videoDuration < mode;
}

/** 定长裁剪窗口实际宽度（秒）：不超过视频总时长 */
export function effectiveWindow(
  videoDuration: number,
  mode: DurationMode,
): number {
  if (videoDuration <= 0) return mode;
  return Math.min(mode, videoDuration);
}

/** 最终导出时长（秒） */
export function exportDuration(
  p: Pick<LivePhotoJobParams, "durationMode" | "fallback" | "videoDuration">,
): number {
  if (
    p.fallback === "keep" &&
    needsFallback(p.videoDuration, p.durationMode)
  ) {
    return p.videoDuration;
  }
  return p.durationMode;
}

export function newContentIdentifier(): string {
  return crypto.randomUUID();
}

/** m:ss.s */
export function formatClock(t: number): string {
  if (!isFinite(t) || t < 0) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

const f2 = (n: number) => n.toFixed(2);

export interface FfmpegPlan {
  videoArgs: string[];
  stillArgs: string[];
  metadataNotes: string[];
}

/**
 * 构建 FFmpeg 参数（参考实现，供阶段三移植）。
 *
 * 联调注意：
 * - content-identifier 的 QuickTime key 以真机（iPhone 相册）验证为准；
 * - still-image-time 为整秒，取 round(keyframeTime)；
 * - targetFps 由后端 ffprobe 读取源帧率后取 min(源, 60)；
 * - 静态图随后用 ExifTool 注入 MakerNotes:ContentIdentifier。
 */
export function buildFfmpegArgs(p: LivePhotoJobParams): FfmpegPlan {
  const T = exportDuration(p);
  const fps = Math.min(p.targetFps, 60);
  const vcodec = p.codec === "hevc" ? "libx265" : "libx264";
  const fade = p.audioFadeSecs;
  const fadeOutStart = f2(Math.max(0, T - fade));
  const short = needsFallback(p.videoDuration, p.durationMode);
  const seg = short ? p.videoDuration : p.durationMode;
  const S = f2(short ? 0 : p.clipStart);

  let vFilter: string;
  let aFilter: string | null = null;

  if (!short) {
    // 常规：定长窗口截取
    vFilter =
      `[0:v]trim=start=${S}:duration=${f2(T)},setpts=PTS-STARTPTS,fps=${fps},settb=AVTB[v]`;
    if (!p.muted) {
      aFilter =
        `[0:a]atrim=start=${S}:duration=${f2(T)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}[a]`;
    }
  } else if (p.fallback === "pingpong") {
    // 正倒放循环：正放+倒放拼接后无限循环，再截到目标时长
    const D = f2(seg);
    const pairFrames = Math.max(2, Math.round(seg * fps) * 2);
    vFilter =
      `[0:v]trim=start=0:duration=${D},setpts=PTS-STARTPTS,fps=${fps},split[a][b];` +
      `[b]reverse[r];[a][r]concat=n=2:v=1:a=0,` +
      `loop=loop=-1:size=${pairFrames},trim=duration=${f2(T)},settb=AVTB[v]`;
    if (!p.muted) {
      const pairSamples = Math.max(2, Math.round(seg * 48000) * 2);
      aFilter =
        `[0:a]aresample=48000,atrim=start=0:duration=${D},asetpts=PTS-STARTPTS,asplit[a1][a2];` +
        `[a2]areverse[ar];[a1][ar]concat=n=2:v=0:a=1,` +
        `aloop=loop=-1:size=${pairSamples},atrim=duration=${f2(T)},` +
        `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}[a]`;
    }
  } else if (p.fallback === "slowdown") {
    // 变速慢放：setpts 拉伸视频，atempo 级联拉伸音频
    const D = f2(seg);
    const stretch = (T / seg).toFixed(4);
    let tempo = seg / T;
    const tempos: string[] = [];
    while (tempo < 0.5) {
      tempos.push("atempo=0.5");
      tempo /= 0.5;
    }
    tempos.push(`atempo=${tempo.toFixed(4)}`);
    vFilter =
      `[0:v]trim=start=0:duration=${D},setpts=${stretch}*PTS,fps=${fps},settb=AVTB[v]`;
    if (!p.muted) {
      aFilter =
        `[0:a]atrim=start=0:duration=${D},asetpts=PTS-STARTPTS,` +
        tempos.join(",") +
        `,afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}[a]`;
    }
  } else {
    // keep：按原长导出，不拉伸
    const D = f2(T);
    vFilter = `[0:v]trim=start=0:duration=${D},setpts=PTS-STARTPTS,fps=${fps},settb=AVTB[v]`;
    if (!p.muted) {
      aFilter =
        `[0:a]atrim=start=0:duration=${D},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${fade},afade=t=out:st=${fadeOutStart}:d=${fade}[a]`;
    }
  }

  const videoArgs = [
    "-i",
    "input.mp4",
    "-filter_complex",
    p.muted || !aFilter ? vFilter : `${vFilter};${aFilter}`,
    "-map",
    "[v]",
    ...(p.muted || !aFilter
      ? ["-an"]
      : ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"]),
    "-c:v",
    vcodec,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "faststart+use_metadata_tags",
    "-metadata",
    `com.apple.quicktime.content-identifier=${p.contentIdentifier}`,
    "-metadata",
    `com.apple.quicktime.still-image-time=${Math.round(p.keyframeTime)}`,
    "output.mov",
  ];

  const stillArgs = [
    "-ss",
    f2(p.keyframeTime),
    "-i",
    "input.mp4",
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "still.jpg",
    "# 随后用 ExifTool 注入：",
    `# exiftool -overwrite_original -MakerNotes:ContentIdentifier=${p.contentIdentifier} still.jpg`,
  ];

  const metadataNotes = [
    `ContentIdentifier: ${p.contentIdentifier}（.mov 与静态图严格匹配）`,
    `still-image-time: ${Math.round(p.keyframeTime)}s（封面帧 ${f2(p.keyframeTime)}s 四舍五入）`,
    "联调时以真机（iPhone 相册）验证元数据键名为准",
  ];

  return { videoArgs, stillArgs, metadataNotes };
}
