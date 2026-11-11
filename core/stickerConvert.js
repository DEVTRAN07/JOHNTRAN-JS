// ===== CHUYỂN ẢNH/GIF/VIDEO → WEBP STICKER =====
// Bản chất giống bot ZALO-BOT gốc: ffmpeg scale 480, tối đa 8 giây, 15fps.
// Máy có ffmpeg kèm libwebp → WebP động; không có (vd ffmpeg Homebrew macOS)
// → fallback GIF (Zalo vẫn nhận, hậu tố URL quyết định render sticker).
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const http = require("./http");
const stickerFrames = require("./stickerFrames");

const TARGET_W = 480;
const MAX_SECONDS = 8;
const FPS = 15;
const SIZE_LIMIT = 512 * 1024; // 512KB: Zalo upload nhanh và ổn định hơn
const FRAME_PATH = path.join(__dirname, "..", "khung-stk", "hoa-anh-dao.png");
const STICKER_DIAMETER = 360;
const STICKER_OFFSET = (TARGET_W - STICKER_DIAMETER) / 2;
const ROUND_R = 28; // bán kính bo góc (px) cho sticker 480x480

const ffmpegBin = "ffmpeg";
const ffprobeBin = "ffprobe";

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

function isAnimatedBuffer(buf) {
  // GIF nhiều frame: đếm bộ giải mã ảnh (0x2C image descriptor) sau header
  if (buf.slice(0, 4).toString() === "GIF8") {
    let count = 0;
    for (let i = 13; i < buf.length - 1; i++) {
      if (buf[i] === 0x00 && buf[i + 1] === 0x2c && buf[i + 2] !== 0x00) count++;
      if (count > 1) return true;
    }
    return false;
  }
  // WebP động: chunk VP8X + flag ANIM (bit 0x02 của byte 20)
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(12, 16).toString() === "VP8X") {
    return (buf[20] & 0x02) !== 0;
  }
  return false;
}

async function convertFramed(inputPath, outPath, duration, isStill, options = {}) {
  const framePath = options.framePath || FRAME_PATH;
  if (!fs.existsSync(framePath)) {
    throw new Error(`Không tìm thấy khung sticker: ${framePath}`);
  }

  const fps = options.fps || FPS;
  const quality = options.quality ?? 65;
  const outputSize = options.outputSize || TARGET_W;
  const useWebp = await hasLibwebp();
  const outFile = useWebp ? outPath : outPath.replace(/\.webp$/, ".gif");
  const graph = [
    // Keep decorative artwork outside the circular sticker area.
    `[1:v]scale=${TARGET_W}:${TARGET_W}:flags=lanczos,format=rgba,tpad=stop_mode=clone:stop_duration=${duration},fps=${fps},setpts=PTS-STARTPTS,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(gt(hypot(X-${TARGET_W / 2 - 0.5},Y-${TARGET_W / 2 - 0.5}),${STICKER_DIAMETER / 2}),1,0)'[frame]`,
    `[0:v]fps=${fps},scale=${STICKER_DIAMETER}:${STICKER_DIAMETER}:force_original_aspect_ratio=increase:flags=lanczos,crop=${STICKER_DIAMETER}:${STICKER_DIAMETER},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte(hypot(X-${STICKER_DIAMETER / 2 - 0.5},Y-${STICKER_DIAMETER / 2 - 0.5}),${STICKER_DIAMETER / 2}),1,0)'[circle]`,
    `[frame][circle]overlay=${STICKER_OFFSET}:${STICKER_OFFSET}:shortest=1,scale=${outputSize}:${outputSize}:flags=lanczos,format=rgba[framed]`
  ];
  if (!useWebp) {
    graph.push(
      "[framed]split[animation][palette_source]",
      "[palette_source]palettegen=stats_mode=diff[palette]",
      "[animation][palette]paletteuse=dither=sierra2_4a[sticker]"
    );
  }

  const args = ["-y"];
  if (isStill) args.push("-loop", "1");
  args.push("-i", inputPath, "-i", framePath, "-t", String(duration));
  args.push("-filter_complex", graph.join(";"), "-map", useWebp ? "[framed]" : "[sticker]", "-an");
  if (useWebp) {
    args.push("-vcodec", "libwebp", "-loop", "0", "-q:v", String(quality), "-preset", "default");
  } else {
    args.push("-loop", "0");
  }
  args.push(outFile);

  const result = await run(ffmpegBin, args, 90000);
  if (!result.ok) {
    throw new Error("ffmpeg ghép khung sticker thất bại: " + result.stderr.slice(-300));
  }
  return { path: outFile, format: useWebp ? "webp" : "gif" };
}

// Video/GIF/ảnh tĩnh → sticker có khung (webp nếu được, không thì gif)
async function convert(inputPath, outPath) {
  return convertFramed(inputPath, outPath, MAX_SECONDS, false);
}

// Ảnh TĨNH → webp loop 2.5 giây (bot gốc vẫn gửi dạng động cho mọi sticker)
async function convertStatic(inputPath, outPath) {
  return convertFramed(inputPath, outPath, 2.5, true);
}

/**
 * Quy trình đầy đủ: URL media → file sticker trên đĩa.
 * @param {string} url  URL ảnh/video/gif (đã làm sạch hậu tố)
 * @param {string} outDir  thư mục tạm
 * @param {boolean} forceStatic  true = coi là ảnh tĩnh (loop 2.5s)
 */
async function makeStickerFile(url, outDir, forceStatic = false, fetchImpl, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const inputPath = await download(url, outDir, fetchImpl);
  const frameId = options.frameId == null ? 1 : Number(options.frameId);
  let framePath;
  try {
    framePath = stickerFrames.resolveFramePath(frameId);
    const buf = fs.readFileSync(inputPath);
    const animated = isAnimatedBuffer(buf) || [".mp4", ".webm"].includes(path.extname(inputPath));

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
      const result = await convertFramed(inputPath, out, duration, isStatic, {
        ...profile,
        framePath
      });
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
  SIZE_LIMIT,
  TARGET_W,
  FPS,
  MAX_SECONDS
};
