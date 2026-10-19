/**
 * Pure client-side Live Photo metadata engine & local generator.
 *
 * Runs 100% in browser (Safari/Chrome/Firefox/Edge) without uploading videos
 * to any server. Handles:
 *   1. JPEG Apple MakerNote (tag 17) injection.
 *   2. QuickTime MOV ISO-BMFF atom parsing & Apple ContentIdentifier / still-image-time track injection.
 *   3. HTML5 Video frame extraction via Canvas.
 *   4. Memory-safe resource lifecycle management (Object URL revocation).
 */

const CONTENT_KEY = new TextEncoder().encode("com.apple.quicktime.content.identifier");
const STILL_TIME_KEY = new TextEncoder().encode("com.apple.quicktime.still-image-time");
const TIMED_SAMPLE = new Uint8Array([0, 0, 0, 9, 0, 0, 0, 1, 0xff]);

const UUID_RE = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;

// Canonical 174-byte EXIF APP1 payload prefix with Apple iOS MakerNote tag 17:
// Contains Make: Apple, Model: iPhone, Software: LiveCraft, ExifIFDPointer, MakerNote tag 17.
const EXIF_TEMPLATE_HEX =
  "4578696600004d4d002a000000080004010f0002000000060000003e011000020000000700000044013100020000000a0000004b876900040000000100000055000000004170706c65006950686f6e65004c6976654372616674000001927c000700000045000000634170706c6520694f530000014d4d000100110002000000250000002000000000";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const EXIF_PREFIX = hexToBytes(EXIF_TEMPLATE_HEX);

/**
 * Injects Apple MakerNote:ContentIdentifier (tag 17) into a JPEG buffer.
 * Replaces or inserts the APP1 Exif segment without touching compressed image data.
 */
export function injectJpgContentIdentifier(
  jpegBytes: Uint8Array,
  contentIdentifier: string,
): Uint8Array {
  const cleanId = contentIdentifier.trim().toUpperCase();
  if (!UUID_RE.test(cleanId)) {
    throw new Error("ContentIdentifier 必须是标准 UUID 格式");
  }

  const idBytes = new TextEncoder().encode(cleanId);
  const exifPayload = new Uint8Array(EXIF_PREFIX.length + 36 + 1);
  exifPayload.set(EXIF_PREFIX, 0);
  exifPayload.set(idBytes, EXIF_PREFIX.length);
  exifPayload[exifPayload.length - 1] = 0; // null terminator

  const markerLen = exifPayload.length + 2;
  const app1 = new Uint8Array(4 + exifPayload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (markerLen >> 8) & 0xff;
  app1[3] = markerLen & 0xff;
  app1.set(exifPayload, 4);

  // Verify SOI marker (FF D8)
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new Error("不是有效的 JPEG 文件（缺少 SOI 标记）");
  }

  // Strip existing APP1 (FF E1) segments if present
  let pos = 2;
  let withoutApp1 = jpegBytes;
  while (pos < withoutApp1.length - 4) {
    if (withoutApp1[pos] === 0xff && withoutApp1[pos + 1] === 0xe1) {
      const segLen = (withoutApp1[pos + 2] << 8) | withoutApp1[pos + 3];
      const nextPos = pos + 2 + segLen;
      const combined = new Uint8Array(withoutApp1.length - (2 + segLen));
      combined.set(withoutApp1.subarray(0, pos), 0);
      combined.set(withoutApp1.subarray(nextPos), pos);
      withoutApp1 = combined;
    } else {
      break;
    }
  }

  // Insert our new APP1 segment right after SOI (FF D8)
  const result = new Uint8Array(2 + app1.length + (withoutApp1.length - 2));
  result[0] = 0xff;
  result[1] = 0xd8;
  result.set(app1, 2);
  result.set(withoutApp1.subarray(2), 2 + app1.length);
  return result;
}

/**
 * Extracts ContentIdentifier UUID from a JPEG buffer if present.
 */
export function readJpgContentIdentifier(jpegBytes: Uint8Array): string | null {
  const latin = new TextDecoder("latin1").decode(jpegBytes);
  const makerIdx = latin.indexOf("Apple iOS");
  if (makerIdx === -1) return null;
  const windowStr = latin.slice(makerIdx, makerIdx + 120);
  const match = windowStr.match(UUID_RE);
  return match ? match[0].toUpperCase() : null;
}

/* -------------------------------------------------------------------------- */
/* ISO-BMFF (QuickTime MOV) Atom Parser & Live Photo Metadata Injector         */
/* -------------------------------------------------------------------------- */

interface AtomHeader {
  start: number;
  size: number;
  kind: string;
  headerSize: number;
  payloadStart: number;
  end: number;
}

function parseAtoms(data: Uint8Array, start = 0, end?: number): AtomHeader[] {
  const boundary = end ?? data.length;
  const atoms: AtomHeader[] = [];
  let pos = start;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  while (pos < boundary) {
    if (pos + 8 > boundary) break;
    let size = view.getUint32(pos);
    const kind = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7],
    );
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > boundary) break;
      size = Number(view.getBigUint64(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = boundary - pos;
    }
    if (size < headerSize || pos + size > boundary) {
      break;
    }
    atoms.push({
      start: pos,
      size,
      kind,
      headerSize,
      payloadStart: pos + headerSize,
      end: pos + size,
    });
    pos += size;
  }
  return atoms;
}

function makeAtom(kind: string, payload: Uint8Array): Uint8Array {
  if (kind.length !== 4) throw new Error("Atom kind 必须是 4 字节");
  const size = payload.length + 8;
  const atom = new Uint8Array(size);
  const view = new DataView(atom.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) {
    atom[4 + i] = kind.charCodeAt(i);
  }
  atom.set(payload, 8);
  return atom;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function makeFullBox(version = 0, flags = 0): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = version & 0xff;
  out[1] = (flags >> 16) & 0xff;
  out[2] = (flags >> 8) & 0xff;
  out[3] = flags & 0xff;
  return out;
}

function makeContentIdentifierMeta(identifier: string): Uint8Array {
  const rawId = new TextEncoder().encode(identifier);
  const hdlrPayload = concatBytes(
    makeFullBox(),
    new Uint8Array(4), // pre_defined
    new TextEncoder().encode("mdta"),
    new Uint8Array(14), // reserved
  );
  const hdlr = makeAtom("hdlr", hdlrPayload);

  const keyPayload = concatBytes(
    new Uint8Array([0, 0, 0, 8 + CONTENT_KEY.length]),
    new TextEncoder().encode("mdta"),
    CONTENT_KEY,
  );
  const keysPayload = concatBytes(
    makeFullBox(),
    new Uint8Array([0, 0, 0, 1]), // entry count = 1
    keyPayload,
  );
  const keys = makeAtom("keys", keysPayload);

  // ilst entry
  const dataBox = makeAtom(
    "data",
    concatBytes(
      new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), // type=1 (UTF8), locale=0
      rawId,
    ),
  );
  const itemBox = makeAtom(String.fromCharCode(0, 0, 0, 1), dataBox);
  const ilst = makeAtom("ilst", itemBox);

  return makeAtom("meta", concatBytes(hdlr, keys, ilst));
}

function makeTimedMetadataTrack(
  trackId: number,
  videoTrackId: number,
  timescale: number,
  coverTicks: number,
  sampleOffset: number,
): Uint8Array {
  const trackDuration = coverTicks + 1;
  const tkhdView = new DataView(new ArrayBuffer(84));
  tkhdView.setUint8(0, 0); // version
  tkhdView.setUint8(3, 0x0f); // flags enabled
  tkhdView.setUint32(12, trackId);
  tkhdView.setUint32(20, trackDuration);
  // Matrix (identity)
  tkhdView.setUint32(36, 0x00010000);
  tkhdView.setUint32(52, 0x00010000);
  tkhdView.setUint32(68, 0x40000000);
  const tkhd = makeAtom("tkhd", new Uint8Array(tkhdView.buffer));

  // Edit list (elst)
  const elstEntries: Uint8Array[] = [];
  if (coverTicks > 0) {
    const emptyEdit = new DataView(new ArrayBuffer(12));
    emptyEdit.setUint32(0, coverTicks);
    emptyEdit.setInt32(4, -1);
    emptyEdit.setUint16(8, 1);
    elstEntries.push(new Uint8Array(emptyEdit.buffer));
  }
  const sampleEdit = new DataView(new ArrayBuffer(12));
  sampleEdit.setUint32(0, 1);
  sampleEdit.setInt32(4, 0);
  sampleEdit.setUint16(8, 1);
  elstEntries.push(new Uint8Array(sampleEdit.buffer));

  const elstPayload = concatBytes(
    makeFullBox(),
    new Uint8Array([0, 0, 0, elstEntries.length]),
    ...elstEntries,
  );
  const edts = makeAtom("edts", makeAtom("elst", elstPayload));

  // tref -> cdsc -> videoTrackId
  const cdscView = new DataView(new ArrayBuffer(4));
  cdscView.setUint32(0, videoTrackId);
  const tref = makeAtom("tref", makeAtom("cdsc", new Uint8Array(cdscView.buffer)));

  // mdhd
  const mdhdView = new DataView(new ArrayBuffer(24));
  mdhdView.setUint32(12, timescale);
  mdhdView.setUint32(16, 1);
  mdhdView.setUint16(20, 0x55c4);
  const mdhd = makeAtom("mdhd", concatBytes(makeFullBox(), new Uint8Array(mdhdView.buffer).subarray(4)));

  // hdlr (Core Media Metadata)
  const hdlrPayload = concatBytes(
    makeFullBox(),
    new TextEncoder().encode("mhlrmetaappl"),
    new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]),
    new Uint8Array([19]), // pascal length
    new TextEncoder().encode("Core Media Metadata"),
  );
  const hdlr = makeAtom("hdlr", hdlrPayload);

  // gmhd -> gmin
  const gminPayload = concatBytes(
    makeFullBox(),
    new Uint8Array([0, 0x40, 0x80, 0, 0x80, 0, 0x80, 0, 0, 0, 0, 0]),
  );
  const gmhd = makeAtom("gmhd", makeAtom("gmin", gminPayload));

  // dinf -> dref -> alis
  const alis = makeAtom("alis", makeFullBox(0, 1));
  const dref = makeAtom("dref", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 1]), alis));
  const dinf = makeAtom("dinf", dref);

  // data handler
  const dataHdlrPayload = concatBytes(
    makeFullBox(),
    new TextEncoder().encode("dhlralisappl"),
    new Uint8Array(8),
    new Uint8Array([23]),
    new TextEncoder().encode("Core Media Data Handler"),
  );
  const dataHdlr = makeAtom("hdlr", dataHdlrPayload);

  // stbl: stsd, stts, stsc, stsz, stco
  const keyd = makeAtom("keyd", concatBytes(new TextEncoder().encode("mdta"), STILL_TIME_KEY));
  const dtyp = makeAtom("dtyp", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 0x41])));
  const keyRecord = concatBytes(
    new Uint8Array([0, 0, 0, 8 + keyd.length + dtyp.length, 0, 0, 0, 1]),
    keyd,
    dtyp,
  );
  const keys = makeAtom("keys", keyRecord);
  const mebx = makeAtom("mebx", concatBytes(new Uint8Array(6), new Uint8Array([0, 1]), keys));
  const stsd = makeAtom("stsd", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 1]), mebx));
  const stts = makeAtom("stts", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])));
  const stsc = makeAtom("stsc", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])));
  const stsz = makeAtom("stsz", concatBytes(makeFullBox(), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, TIMED_SAMPLE.length])));

  const chunkOffsetPayload = new DataView(new ArrayBuffer(8));
  chunkOffsetPayload.setUint32(0, 1);
  chunkOffsetPayload.setUint32(4, sampleOffset);
  const stco = makeAtom("stco", concatBytes(makeFullBox(), new Uint8Array(chunkOffsetPayload.buffer)));

  const stbl = makeAtom("stbl", concatBytes(stsd, stts, stsc, stsz, stco));
  const minf = makeAtom("minf", concatBytes(gmhd, dataHdlr, dinf, stbl));
  const mdia = makeAtom("mdia", concatBytes(mdhd, hdlr, minf));

  return makeAtom("trak", concatBytes(tkhd, edts, tref, mdia));
}

function patchChunkOffsets(moovPayload: Uint8Array, delta: number): Uint8Array {
  const copy = new Uint8Array(moovPayload);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);

  function walk(start: number, end: number) {
    const atoms = parseAtoms(copy, start, end);
    for (const a of atoms) {
      if (a.kind === "stco") {
        const count = view.getUint32(a.payloadStart + 4);
        for (let i = 0; i < count; i++) {
          const off = a.payloadStart + 8 + i * 4;
          const oldVal = view.getUint32(off);
          view.setUint32(off, oldVal + delta);
        }
      } else if (a.kind === "co64") {
        const count = view.getUint32(a.payloadStart + 4);
        for (let i = 0; i < count; i++) {
          const off = a.payloadStart + 8 + i * 8;
          const oldVal = view.getBigUint64(off);
          view.setBigUint64(off, oldVal + BigInt(delta));
        }
      } else if (["trak", "mdia", "minf", "stbl", "edts", "udta"].includes(a.kind)) {
        walk(a.payloadStart, a.end);
      }
    }
  }

  walk(0, copy.length);
  return copy;
}

/**
 * Injects Apple QuickTime metadata & timed metadata track into an MOV/MP4 buffer.
 */
export function injectMovLivePhoto(
  movBytes: Uint8Array,
  contentIdentifier: string,
  stillTime = 0,
  duration = 3,
): Uint8Array {
  const cleanId = contentIdentifier.trim().toUpperCase();
  if (!UUID_RE.test(cleanId)) {
    throw new Error("ContentIdentifier 必须是标准 UUID 格式");
  }

  const topAtoms = parseAtoms(movBytes);
  const mdat = topAtoms.find((a) => a.kind === "mdat");
  const moov = topAtoms.find((a) => a.kind === "moov");
  if (!mdat || !moov) {
    throw new Error("MOV/MP4 文件缺少 mdat 或 moov atom，无法注入实况元数据");
  }

  const moovChildren = parseAtoms(movBytes, moov.payloadStart, moov.end);
  const mvhd = moovChildren.find((a) => a.kind === "mvhd");
  if (!mvhd) throw new Error("MOV 缺少 mvhd atom");

  const view = new DataView(movBytes.buffer, movBytes.byteOffset, movBytes.byteLength);
  const version = movBytes[mvhd.payloadStart];
  const timescalePos = mvhd.start + (version === 1 ? 28 : 20);
  const timescale = view.getUint32(timescalePos) || 600;

  // Find video track
  const traks = moovChildren.filter((a) => a.kind === "trak");
  let videoTrackId = 1;
  let maxTrackId = 1;

  for (const trak of traks) {
    const tkhd = parseAtoms(movBytes, trak.payloadStart, trak.end).find((a) => a.kind === "tkhd");
    if (tkhd) {
      const tkhdVer = movBytes[tkhd.payloadStart];
      const tidPos = tkhd.start + (tkhdVer === 1 ? 28 : 20);
      const tid = view.getUint32(tidPos);
      if (tid > maxTrackId) maxTrackId = tid;

      const mdia = parseAtoms(movBytes, trak.payloadStart, trak.end).find((a) => a.kind === "mdia");
      if (mdia) {
        const hdlr = parseAtoms(movBytes, mdia.payloadStart, mdia.end).find((a) => a.kind === "hdlr");
        if (hdlr && hdlr.start + 20 <= hdlr.end) {
          const handlerType = String.fromCharCode(...movBytes.subarray(hdlr.start + 16, hdlr.start + 20));
          if (handlerType === "vide") {
            videoTrackId = tid;
          }
        }
      }
    }
  }

  const metadataTrackId = maxTrackId + 1;
  const coverTicks = Math.max(0, Math.min(Math.round(stillTime * timescale), Math.round(duration * timescale) - 1));

  // Build new mdat by appending timed sample
  const prefixAtoms = topAtoms.filter((a) => a.kind !== "mdat" && a.kind !== "moov");
  const prefixParts = prefixAtoms.map((a) => movBytes.subarray(a.start, a.end));
  const prefix = concatBytes(...prefixParts);

  const oldMedia = movBytes.subarray(mdat.payloadStart, mdat.end);
  const newMdat = makeAtom("mdat", concatBytes(oldMedia, TIMED_SAMPLE));
  const newMediaStart = prefix.length + 8; // standard 32-bit atom header
  const delta = newMediaStart - mdat.payloadStart;
  const sampleOffset = newMediaStart + oldMedia.length;

  // Patch moov chunk offsets
  const moovPayload = movBytes.subarray(moov.payloadStart, moov.end);
  const patchedMoovPayload = patchChunkOffsets(moovPayload, delta);

  // Add metadata additions to moov
  const metaAtom = makeContentIdentifierMeta(cleanId);
  const metaTrackAtom = makeTimedMetadataTrack(
    metadataTrackId,
    videoTrackId,
    timescale,
    coverTicks,
    sampleOffset,
  );
  const newMoov = makeAtom("moov", concatBytes(patchedMoovPayload, metaAtom, metaTrackAtom));

  return concatBytes(prefix, newMdat, newMoov);
}

/**
 * Extracts ContentIdentifier UUID from an MOV buffer if present.
 */
export function readMovContentIdentifier(movBytes: Uint8Array): string | null {
  const latin = new TextDecoder("latin1").decode(movBytes);
  if (!latin.includes("com.apple.quicktime.content.identifier")) return null;
  const match = latin.match(UUID_RE);
  return match ? match[0].toUpperCase() : null;
}

/* -------------------------------------------------------------------------- */
/* HTML5 Video Frame Extraction via Canvas                                     */
/* -------------------------------------------------------------------------- */

export interface FrameExtractResult {
  blob: Blob;
  width: number;
  height: number;
  duration: number;
}

/**
 * Extracts a still frame from a video file at timestampSecs using HTML5 Video + Canvas.
 * Safely cleans up the Object URL and video element to prevent iOS Safari memory bloat.
 */
export async function extractVideoFrame(
  videoFile: File | Blob,
  timestampSecs = 0,
  quality = 0.95,
): Promise<FrameExtractResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    let objectUrl = "";
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      video.removeAttribute("src");
      video.load();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频截帧超时（15 秒），请尝试调整封面时刻或重试"));
    }, 15000);

    video.onloadedmetadata = () => {
      const d = video.duration || 1;
      const targetTime = Math.min(Math.max(0, timestampSecs), Math.max(0, d - 0.05));
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      window.clearTimeout(timer);
      try {
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("无法初始化 Canvas 绘图环境"));
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            cleanup();
            if (!blob || blob.size === 0) {
              reject(new Error("Canvas 导出的封面图为空"));
              return;
            }
            resolve({
              blob,
              width,
              height,
              duration: video.duration || 0,
            });
          },
          "image/jpeg",
          quality,
        );
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("浏览器无法解码当前视频格式，请检查视频是否有效"));
    };

    try {
      objectUrl = URL.createObjectURL(videoFile);
      video.src = objectUrl;
    } catch (e) {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error(`无法读取视频文件对象：${e}`));
    }
  });
}

/* -------------------------------------------------------------------------- */
/* In-Browser Zero-Dependency ZIP Packager (Store Mode, Zero-Copy)            */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function createZipBlob(files: { name: string; bytes: Uint8Array }[]): Blob {
  const parts: ArrayBuffer[] = [];
  const centralDirHeaders: ArrayBuffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const fileCrc = crc32(file.bytes);
    const size = file.bytes.length;

    // Local file header (30 bytes + name)
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // store (no compression)
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0, true); // date
    lv.setUint32(14, fileCrc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    local.set(nameBytes, 30);

    parts.push(local.buffer as ArrayBuffer);
    parts.push(file.bytes.buffer as ArrayBuffer);

    // Central directory header (46 bytes + name)
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // store
    cv.setUint16(12, 0, true); // time
    cv.setUint16(14, 0, true); // date
    cv.setUint32(16, fileCrc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attr
    cv.setUint32(38, 0, true); // external attr
    cv.setUint32(42, offset, true); // relative offset of local header
    cd.set(nameBytes, 46);

    centralDirHeaders.push(cd.buffer as ArrayBuffer);
    offset += local.length + file.bytes.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralDirHeaders) {
    parts.push(h);
    centralDirSize += h.byteLength;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true);

  parts.push(eocd.buffer as ArrayBuffer);

  return new Blob(parts, { type: "application/zip" });
}

/* -------------------------------------------------------------------------- */
/* Complete Local Live Photo Generator                                        */
/* -------------------------------------------------------------------------- */

export interface LocalLivePhotoOptions {
  durationMode: 3 | 5;
  clipStart?: number;
  keyframeTime?: number | null;
  contentIdentifier?: string;
}

export interface LocalLivePhotoOutput {
  stillFile: File;
  movFile: File;
  stillBlob: Blob;
  movBlob: Blob;
  zipBlob: Blob;
  stillUrl: string;
  movUrl: string;
  zipUrl: string;
  contentIdentifier: string;
  sourceDuration: number;
  stillTime: number;
  fileBaseName: string;
  revoke: () => void;
}

/**
 * Generates an Apple Live Photo completely in the browser.
 * Injects matching ContentIdentifier into both JPG (MakerNote 17) and MOV (atoms).
 */
export async function createLocalLivePhoto(
  videoFile: File,
  options: LocalLivePhotoOptions,
): Promise<LocalLivePhotoOutput> {
  const uuid = (options.contentIdentifier || crypto.randomUUID()).toUpperCase();
  const targetDuration = options.durationMode;
  const clipStart = options.clipStart ?? 0;
  const stillTime = options.keyframeTime != null ? options.keyframeTime : clipStart + targetDuration / 2;

  // 1. Extract still frame via Canvas
  const frameResult = await extractVideoFrame(videoFile, stillTime, 0.95);

  // 2. Read JPEG and inject Apple MakerNote
  const rawJpgBytes = new Uint8Array(await frameResult.blob.arrayBuffer());
  const finalJpgBytes = injectJpgContentIdentifier(rawJpgBytes, uuid);

  // 3. Read video file and inject MOV atoms
  const rawMovBytes = new Uint8Array(await videoFile.arrayBuffer());
  const finalMovBytes = injectMovLivePhoto(
    rawMovBytes,
    uuid,
    Math.max(0, stillTime - clipStart),
    targetDuration,
  );

  // 4. Verify pair integrity
  const verifiedJpg = readJpgContentIdentifier(finalJpgBytes);
  const verifiedMov = readMovContentIdentifier(finalMovBytes);
  if (!verifiedJpg || !verifiedMov || verifiedJpg !== verifiedMov) {
    throw new Error(
      `实况照片元数据配对校验失败（JPG: ${verifiedJpg || "缺失"}，MOV: ${verifiedMov || "缺失"}）`,
    );
  }

  const baseName = `IMG_${uuid.slice(0, 8)}`;
  const stillBlob = new Blob([finalJpgBytes.buffer as ArrayBuffer], { type: "image/jpeg" });
  const movBlob = new Blob([finalMovBytes.buffer as ArrayBuffer], { type: "video/quicktime" });

  const stillFile = new File([stillBlob], `${baseName}.JPG`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
  const movFile = new File([movBlob], `${baseName}.MOV`, {
    type: "video/quicktime",
    lastModified: Date.now(),
  });

  // Pack into Store-mode ZIP
  const zipBlob = createZipBlob([
    { name: `${baseName}.JPG`, bytes: finalJpgBytes },
    { name: `${baseName}.MOV`, bytes: finalMovBytes },
  ]);

  const stillUrl = URL.createObjectURL(stillBlob);
  const movUrl = URL.createObjectURL(movBlob);
  const zipUrl = URL.createObjectURL(zipBlob);

  const revoke = () => {
    URL.revokeObjectURL(stillUrl);
    URL.revokeObjectURL(movUrl);
    URL.revokeObjectURL(zipUrl);
  };

  return {
    stillFile,
    movFile,
    stillBlob,
    movBlob,
    zipBlob,
    stillUrl,
    movUrl,
    zipUrl,
    contentIdentifier: uuid,
    sourceDuration: frameResult.duration,
    stillTime,
    fileBaseName: baseName,
    revoke,
  };
}
