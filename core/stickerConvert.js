// ===== CHUYỂN ẢNH/GIF/VIDEO → WEBP STICKER =====
// Bản chất giống bot ZALO-BOT gốc: ffmpeg scale 480, tối đa 8 giây, 15fps.
// Máy có ffmpeg kèm libwebp → WebP động; không có (vd ffmpeg Homebrew macOS)
// → fallback GIF (Zalo vẫn nhận, hậu tố URL quyết định render sticker).
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const http = require("./http");

const TARGET_W = 480;
const MAX_SECONDS = 8;
const FPS = 15;
const SIZE_LIMIT = 512 * 1024; // 512KB: Zalo upload nhanh và ổn định hơn

function resolveFfmpegBinary({ envPath = process.env.FFMPEG_PATH, staticPath } = {}) {
  let packagedPath = staticPath;
  if (packagedPath === undefined) {
    try { packagedPath = require("ffmpeg-static"); } catch { packagedPath = null; }
  }

  for (const candidate of [envPath, packagedPath]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = candidate.trim();
    try {
      if (path.isAbsolute(resolved)) {
        fs.accessSync(resolved, fs.constants.X_OK);
      } else {
        // A command name such as "ffmpeg" is resolved by the operating system PATH.
      }
      return resolved;
    } catch {
      // Ignore stale paths from platform configuration and try the packaged binary.
    }
  }
  return "ffmpeg";
}

const ffmpegBin = resolveFfmpegBinary();

let libwebpCache = null; // true | false | null (chưa probe)

function run(cmd, args, timeout = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr: String(stderr || "") });
    });
  });
}

// ffmpeg build không kèm libwebp (Homebrew) → -vcodec libwebp luôn fail (exit 8)
async function hasLibwebp() {
  if (libwebpCache !== null) return libwebpCache;
  const r = await run(ffmpegBin, ["-hide_banner", "-encoders"], 15000);
  libwebpCache = r.ok && r.stdout.includes("libwebp");
  return libwebpCache;
}

function magicExt(buf) {
  if (buf.slice(0, 6).toString() === "GIF87a" || buf.slice(0, 6).toString() === "GIF89a") return ".gif";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return ".webp";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length > 8 && buf.slice(4, 8).toString() === "ftyp") return ".mp4";
  if (buf.slice(0, 4).toString("hex") === "1a45dfa3") return ".webm";
  return "";
}

// Tải media từ URL. fetchImpl tuỳ biến (vd session Zalo) hoặc core/http.
async function download(url, outDir, fetchImpl) {
  // Cho phép url là đường dẫn file cục bộ đã được tải ở main thread
  // (cần api session, ví dụ api.fetchZaloMedia) trước khi giao cho worker convert.
  if (path.isAbsolute(url) && fs.existsSync(url)) {
    const buf = fs.readFileSync(url);
    if (!buf || buf.length < 64) throw new Error("File tải về quá nhỏ hoặc rỗng");
    const ext = magicExt(buf) || ".bin";
    const filePath = path.join(outDir, `src_${Date.now()}${ext}`);
    fs.writeFileSync(filePath, buf);
    return filePath;
  }
  const fetchFn = fetchImpl || ((u) => http.getBuffer(u, { timeout: 60000 }));
  const { buffer } = await fetchFn(url);
  if (!buffer || buffer.length < 64) throw new Error("File tải về quá nhỏ hoặc rỗng");
  const ext = magicExt(buffer) || ".bin";
  const filePath = path.join(outDir, `src_${Date.now()}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// Kích thước ảnh — đọc header thẳng (PNG/GIF/JPEG/WebP), không decode
function imageSize(buf) {
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
    const chunk = buf.slice(12, 16).toString();
    if (chunk === "VP8X") {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === "VP8 ") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.slice(0, 4).toString() === "GIF8") {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + buf.readUInt16LE(offset + 2);
    }
  }
  return { width: TARGET_W, height: TARGET_W };
}

function skipGifSubBlocks(buf, offset) {
  while (offset < buf.length) {
    const size = buf[offset++];
    if (size === 0) return offset;
    if (offset + size > buf.length) return buf.length;
    offset += size;
  }
  return offset;
}

function isAnimatedGif(buf) {
  if (buf.length < 13 || !/^GIF8[79]a$/.test(buf.subarray(0, 6).toString())) return false;

  const packed = buf[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;

  while (offset < buf.length) {
    const marker = buf[offset++];
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      // Extension block: label then a sequence of size-prefixed sub-blocks.
      if (offset >= buf.length) break;
      offset = skipGifSubBlocks(buf, offset + 1);
      continue;
    }
    if (marker !== 0x2c) break; // image descriptor
    if (offset + 9 > buf.length) break;

    const imagePacked = buf[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    if (offset >= buf.length) break;
    offset = skipGifSubBlocks(buf, offset + 1); // LZW minimum code size + data blocks

    frames++;
    if (frames > 1) return true;
  }
  return false;
}

function isAnimatedBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return false;
  if (isAnimatedGif(buf)) return true;

  // WebP animation is marked by VP8X animation flag and/or ANIM/ANMF chunks.
  if (buf.subarray(0, 4).toString() !== "RIFF" || buf.subarray(8, 12).toString() !== "WEBP") {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunk = buf.subarray(offset, offset + 4).toString();
    const size = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunk === "ANIM" || chunk === "ANMF") return true;
    if (chunk === "VP8X" && size >= 1 && (buf[dataOffset] & 0x02) !== 0) return true;
    offset = dataOffset + size + (size & 1);
  }
  return false;
}

async function convertClean(inputPath, outPath, duration, isStill, options = {}) {
  const fps = options.fps || FPS;
  const quality = options.quality ?? 65;
  const outputSize = options.outputSize || TARGET_W;
  const useWebp = await hasLibwebp();
  const outFile = useWebp ? outPath : outPath.replace(/\\.webp$/, ".gif");
  const graph = [
    // Full-bleed square crop: không khung, không viền, không họa tiết phủ lên ảnh.
    `[0:v]fps=${fps},scale=${TARGET_W}:${TARGET_W}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_W}:${TARGET_W},scale=${outputSize}:${outputSize}:flags=lanczos,format=rgba[clean]`
  ];
  if (!useWebp) {
    graph.push(
      "[clean]split[animation][palette_source]",
      "[palette_source]palettegen=stats_mode=diff[palette]",
      "[animation][palette]paletteuse=dither=sierra2_4a[sticker]"
    );
  }

  const args = ["-y"];
  if (isStill) args.push("-loop", "1");
  args.push("-i", inputPath, "-t", String(duration));
  args.push("-filter_complex", graph.join(";"), "-map", useWebp ? "[clean]" : "[sticker]", "-an");
  if (useWebp) {
    args.push("-vcodec", "libwebp", "-loop", "0", "-q:v", String(quality), "-preset", "default");
  } else {
    args.push("-loop", "0");
  }
  args.push(outFile);

  const result = await run(ffmpegBin, args, 90000);
  if (!result.ok) {
    throw new Error("ffmpeg chuyển sticker thất bại: " + result.stderr.slice(-300));
  }
  return { path: outFile, format: useWebp ? "webp" : "gif" };
}

async function convert(inputPath, outPath) {
  return convertClean(inputPath, outPath, MAX_SECONDS, false);
}

async function convertStatic(inputPath, outPath) {
  return convertClean(inputPath, outPath, 2.5, true);
}

/**
 * Quy trình đầy đủ: URL media → file sticker trên đĩa.
 * @param {string} url  URL ảnh/video/gif (đã làm sạch hậu tố)
 * @param {string} outDir  thư mục tạm
 * @param {boolean} forceStatic  true = coi là ảnh tĩnh (loop 2.5s)
 */
async function makeStickerFile(url, outDir, forceStatic = false, fetchImpl) {
  fs.mkdirSync(outDir, { recursive: true });
  const inputPath = await download(url, outDir, fetchImpl);
  try {
    const buf = fs.readFileSync(inputPath);
    const animated = isAnimatedBuffer(buf) || /\\.(mp4|webm)$/i.test(inputPath);
    const out = path.join(outDir, `stk_${Date.now()}.webp`);
    const isStatic = !animated || forceStatic;
    const duration = isStatic ? 2.5 : MAX_SECONDS;
    const profiles = [
      { fps: FPS, quality: 65, outputSize: TARGET_W },
      { fps: 10, quality: 40, outputSize: TARGET_W },
      { fps: 8, quality: 30, outputSize: 360 },
      { fps: 6, quality: 25, outputSize: 240 }
    ];

    for (const profile of profiles) {
      const result = await convertClean(inputPath, out, duration, isStatic, profile);
      const size = fs.statSync(result.path).size;
      if (size <= SIZE_LIMIT) {
        const dims = imageSize(fs.readFileSync(result.path));
        return { ...result, size, ...dims };
      }
      try { fs.unlinkSync(result.path); } catch { /* retry below */ }
    }

    throw new Error(`Sticker vượt giới hạn ${Math.round(SIZE_LIMIT / 1024)}KB sau khi nén`);
  } finally {
    try { fs.unlinkSync(inputPath); } catch { /* bỏ qua */ }
  }
}

module.exports = {
  makeStickerFile,
  convert,
  convertStatic,
  download,
  imageSize,
  isAnimatedBuffer,
  hasLibwebp,
  resolveFfmpegBinary,
  ffmpegBin,
  SIZE_LIMIT,
  TARGET_W,
  FPS,
  MAX_SECONDS
};
