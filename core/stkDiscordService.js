"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const stickerService = require("./stickerService");
const catalog = require("./data/stkDiscord200.json");

const DECOR_DIR = path.join(__dirname, "..", "data", "discord_decor");
const TMP_DIR = path.join(__dirname, "..", "cache", "temp");
const CANVAS_SIZE = 288;
const AVATAR_SIZE = 240;
const OFFSET = 24;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_DECORATION_BYTES = 10 * 1024 * 1024;
const ANIMATION_SECONDS = 5;
const DEFAULT_FPS = 15;

function getDecoration(id) {
  const number = Number(id);
  if (!Number.isInteger(number) || number < 1 || number > 200) return null;
  return catalog.items[number - 1] || null;
}

function findDecorationFile(id) {
  const info = getDecoration(id);
  if (!info) throw new RangeError("Số thứ tự khung phải từ 1 đến 200.");

  const expected = path.join(DECOR_DIR, info.file);
  if (fs.existsSync(expected)) return expected;

  if (!fs.existsSync(DECOR_DIR)) {
    throw new Error("Chưa có thư mục khung Discord: " + DECOR_DIR);
  }
  const prefix = String(info.id) + "_";
  const alternate = fs.readdirSync(DECOR_DIR)
    .filter(name => name.startsWith(prefix) && /\.(png|gif|webp|apng)$/i.test(name))
    .sort()[0];
  if (alternate) return path.join(DECOR_DIR, alternate);

  const error = new Error("Không tìm thấy tài nguyên khung #" + id + " (" + info.file + ").");
  error.code = "STK_DECORATION_NOT_FOUND";
  error.decoration = info;
  throw error;
}

function isAnimatedBuffer(buffer, extension = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  const ext = String(extension).toLowerCase();

  if (/\.(mp4|m4v|mov|webm|mkv)$/i.test(ext)) return true;

  if (ext === ".gif" || buffer.subarray(0, 6).toString() === "GIF87a" ||
      buffer.subarray(0, 6).toString() === "GIF89a") {
    let frames = 0;
    for (let i = 13; i < buffer.length; i++) {
      if (buffer[i] === 0x2c && ++frames > 1) return true;
    }
    return false;
  }

  if (ext === ".png" || (buffer[0] === 0x89 && buffer.subarray(1, 4).toString() === "PNG")) {
    return buffer.includes(Buffer.from("acTL"));
  }

  if (ext === ".webp" || (buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP")) {
    return buffer.includes(Buffer.from("ANIM")) || buffer.includes(Buffer.from("ANMF"));
  }

  return false;
}

function inputArgs(filePath, extension, animated, fps) {
  const ext = String(extension || path.extname(filePath)).toLowerCase();
  if (!animated && /^\.(png|jpe?g)$/i.test(ext)) {
    return ["-loop", "1", "-framerate", String(fps), "-i", filePath];
  }
  return ["-stream_loop", "-1", "-i", filePath];
}

function buildFilterGraph(fps = DEFAULT_FPS) {
  // Crop the source to a centred circle (240x240), place it at 24,24 on a
  // transparent 288x288 canvas, then composite the full-canvas Discord frame.
  const alpha = "alpha(X,Y)*lt(hypot(X-W/2\\,Y-H/2)\\,min(W\\,H)/2)";
  return [
    "[0:v]scale=" + AVATAR_SIZE + ":" + AVATAR_SIZE +
      ":force_original_aspect_ratio=increase:flags=lanczos," +
      "crop=" + AVATAR_SIZE + ":" + AVATAR_SIZE +
      ",setsar=1,format=rgba," +
      "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='" + alpha + "'[avatar]",
    "[1:v]scale=" + CANVAS_SIZE + ":" + CANVAS_SIZE +
      ":force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=" + CANVAS_SIZE + ":" + CANVAS_SIZE +
      ":(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba[decor]",
    "[2:v]format=rgba[base]",
    "[base][avatar]overlay=" + OFFSET + ":" + OFFSET + ":format=auto[stage]",
    "[stage][decor]overlay=0:0:format=auto,format=rgba,fps=" + fps + "[out]"
  ].join(";");
}

function runFfmpeg(binary, args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || "");
        error.stdout = String(stdout || "");
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function makeTempName(prefix, extension) {
  return path.join(TMP_DIR,
    prefix + "_" + process.pid + "_" + Date.now() + "_" +
    crypto.randomBytes(4).toString("hex") + extension);
}

function getReplyQuote(event) {
  return event?.data?.quote || event?.data?.dQuote || event?.quote || null;
}

async function createWebp(sourcePath, sourceBuffer, sourceExtension, decorationPath) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const binary = stickerService.resolveFfmpegBinary();
  if (!(await stickerService.hasWebpEncoder())) {
    throw new Error("FFmpeg trên máy chủ chưa hỗ trợ libwebp. Hãy cài FFmpeg có encoder libwebp.");
  }

  const overlayBuffer = fs.readFileSync(decorationPath);
  if (!overlayBuffer.length || overlayBuffer.length > MAX_DECORATION_BYTES) {
    throw new Error("Tệp khung Discord rỗng hoặc vượt giới hạn 10 MB.");
  }

  const sourceAnimated = isAnimatedBuffer(sourceBuffer, sourceExtension);
  const overlayAnimated = isAnimatedBuffer(overlayBuffer, path.extname(decorationPath));
  const animated = sourceAnimated || overlayAnimated;
  const profiles = [
    { fps: 18, quality: 45 },
    { fps: 15, quality: 40 },
    { fps: 12, quality: 35 },
    { fps: 10, quality: 30 },
    { fps: 8, quality: 25 }
  ];
  let lastError = null;
  const { createCanvas } = require("canvas");
  const transparentBasePath = makeTempName("stk_base", ".png");
  const transparentBase = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  fs.writeFileSync(transparentBasePath, transparentBase.toBuffer("image/png"));

  try {
    for (const profile of profiles) {
      const outputPath = makeTempName("stk_dis", ".webp");
      const filter = buildFilterGraph(profile.fps);
      const args = [
        "-hide_banner", "-loglevel", "error", "-y",
        ...inputArgs(sourcePath, sourceExtension, sourceAnimated, profile.fps),
        ...inputArgs(decorationPath, path.extname(decorationPath), overlayAnimated, profile.fps),
        "-loop", "1", "-framerate", String(profile.fps), "-i", transparentBasePath,
        "-filter_complex", filter,
        "-map", "[out]",
        "-an"
      ];

    if (animated) args.push("-t", String(ANIMATION_SECONDS));
    else args.push("-frames:v", "1");

    args.push(
      "-c:v", "libwebp",
      "-lossless", "0",
      "-q:v", String(profile.quality),
      "-compression_level", "4",
      "-preset", "picture",
      "-pix_fmt", "yuva420p",
      "-loop", "0",
      outputPath
    );

    try {
      await runFfmpeg(binary, args);
      const stat = fs.statSync(outputPath);
      if (stat.size > 0 && stat.size <= MAX_OUTPUT_BYTES) {
        return {
          path: outputPath,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          size: stat.size,
          animated,
          format: "webp"
        };
      }
      lastError = new Error("Sticker sau nén vượt giới hạn 512 KB.");
    } catch (error) {
      lastError = new Error(
        "Không thể ghép khung Discord bằng FFmpeg: " +
        String(error.stderr || error.message || error).slice(-500)
      );
    }

    try { fs.rmSync(outputPath, { force: true }); } catch {}
    }
  } finally {
    try { fs.rmSync(transparentBasePath, { force: true }); } catch {}
  }

  throw lastError || new Error("Không thể tạo sticker Discord.");
}

function extractUploadedUrl(uploaded) {
  const root = uploaded && typeof uploaded === "object" ? uploaded : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data : root;
  return data.normalUrl || data.hdUrl || data.thumbUrl || data.fileUrl ||
    data.url || data.oriUrl || root.normalUrl || root.hdUrl ||
    root.thumbUrl || root.fileUrl || root.url || null;
}

async function processDiscordSticker({ api, event, mediaUrl, decorationId }) {
  if (!api || !event?.threadId) throw new Error("Thiếu thông tin cuộc trò chuyện để gửi sticker.");
  const decoration = getDecoration(decorationId);
  if (!decoration) throw new RangeError("Khung Discord phải nằm trong khoảng 1–200.");

  const normalizedUrl = stickerService.normalizeSourceUrl(mediaUrl);
  if (!normalizedUrl) throw new Error("Không tìm thấy URL ảnh/sticker hợp lệ.");

  const decorationPath = findDecorationFile(decorationId);
  stickerService.registerStickerApi(api);
  fs.mkdirSync(TMP_DIR, { recursive: true });

  let sourcePath = null;
  let outputPath = null;
  try {
    const source = await stickerService.fetchSource(api, normalizedUrl);
    const extension = stickerService.sourceExtension(normalizedUrl, source.contentType, source.buffer);
    if (extension === ".bin") {
      throw new Error("Không nhận diện được định dạng ảnh/video. Hỗ trợ PNG, JPG, GIF, WebP, MP4, MOV và WebM.");
    }

    sourcePath = makeTempName("stk_source", extension);
    fs.writeFileSync(sourcePath, source.buffer);

    const output = await createWebp(sourcePath, source.buffer, extension, decorationPath);
    outputPath = output.path;

    if (typeof api.uploadStickerImage !== "function" ||
        typeof api.sendCustomStickerUrl !== "function") {
      throw new Error("Phiên Zalo chưa khởi tạo API upload/send sticker. Hãy khởi động lại bot.");
    }

    const uploaded = await api.uploadStickerImage({
      filePath: outputPath,
      threadId: event.threadId,
      threadType: event.type
    });
    const cdnUrl = extractUploadedUrl(uploaded);
    if (!cdnUrl) throw new Error("Zalo không trả về URL CDN sau khi upload sticker.");

    const quote = getReplyQuote(event);
    const sent = await api.sendCustomStickerUrl({
      staticImgUrl: stickerService.buildStickerUrl(String(cdnUrl), true),
      animationImgUrl: stickerService.buildStickerUrl(String(cdnUrl), true),
      threadId: event.threadId,
      threadType: event.type,
      reply: quote?.msgId || null,
      width: output.width,
      height: output.height
    });

    return { ...output, response: sent, decoration };
  } finally {
    for (const filePath of [sourcePath, outputPath]) {
      if (!filePath) continue;
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
  }
}

module.exports = {
  DECOR_DIR,
  TMP_DIR,
  CANVAS_SIZE,
  AVATAR_SIZE,
  OFFSET,
  MAX_OUTPUT_BYTES,
  catalog,
  getDecoration,
  findDecorationFile,
  isAnimatedBuffer,
  inputArgs,
  buildFilterGraph,
  createWebp,
  extractUploadedUrl,
  processDiscordSticker
};
