"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const stickerService = require("./stickerService");
const catalog = require("./data/stkDiscord200.json");

const RAW_BASE_URL = String(process.env.STK_DISCORD_RAW_BASE_URL ||
  "https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main").replace(/\/+$/, "");
const DEFAULT_CACHE_ROOT = process.env.JT_PERSISTENT_DIR || path.join(__dirname, "..", "cache");
const DECOR_DIR = path.resolve(process.env.STK_DISCORD_CACHE_DIR ||
  path.join(DEFAULT_CACHE_ROOT, "stk-discord"));
const TMP_DIR = path.join(__dirname, "..", "cache", "temp");
const CANVAS_SIZE = 288;
const AVATAR_SIZE = 240;
const OFFSET = 24;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_DECORATION_BYTES = 10 * 1024 * 1024;
const MAX_MENU_BYTES = 8 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMOTE_TIMEOUT_MS = 20000;
const ANIMATION_SECONDS = 5;
const DEFAULT_FPS = 15;
const remoteDownloads = new Map();

function getDecoration(id) {
  const number = Number(id);
  if (!Number.isInteger(number) || number < 1 || number > 200) return null;
  return catalog.items[number - 1] || null;
}

function isUsableAsset(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function resolveDecorationFile(id, directory = DECOR_DIR) {
  const info = getDecoration(id);
  if (!info) return null;

  const expected = path.join(directory, info.file);
  if (isUsableAsset(expected)) return expected;

  try {
    const prefix = String(info.id) + "_";
    const alternate = fs.readdirSync(directory)
      .filter(name => name.startsWith(prefix) && /\.(png|gif|webp|apng)$/i.test(name))
      .sort()
      .map(name => path.join(directory, name))
      .find(isUsableAsset);
    return alternate || null;
  } catch {
    return null;
  }
}

function findDecorationFile(id, directory = DECOR_DIR) {
  const info = getDecoration(id);
  if (!info) throw new RangeError("Số thứ tự khung phải từ 1 đến 200.");

  const found = resolveDecorationFile(id, directory);
  if (found) return found;

  const error = new Error("Không tìm thấy tài nguyên khung #" + id + " (" + info.file + ").");
  error.code = "STK_DECORATION_NOT_FOUND";
  error.decoration = info;
  throw error;
}

function getAssetStatus(directory = DECOR_DIR) {
  const menuPath = path.join(directory, "menu.jpg");
  const menuReady = isUsableAsset(menuPath);
  const missing = catalog.items
    .filter(item => !resolveDecorationFile(item.id, directory))
    .map(item => ({ id: item.id, name: item.name, file: item.file }));
  return {
    directory,
    menu: { path: menuPath, exists: menuReady },
    total: catalog.items.length,
    available: catalog.items.length - missing.length,
    missingCount: missing.length,
    missing
  };
}


function isValidImageBuffer(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".gif") {
    return buffer.subarray(0, 6).toString() === "GIF87a" ||
      buffer.subarray(0, 6).toString() === "GIF89a";
  }
  if (extension === ".webp") {
    return buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP";
  }
  return false;
}

function buildRawAssetUrl(fileName, baseUrl = RAW_BASE_URL) {
  const safeName = String(fileName || "");
  if (!safeName || path.basename(safeName) !== safeName || safeName.includes("..")) {
    throw new Error("Tên tài nguyên STK không hợp lệ.");
  }
  return String(baseUrl || RAW_BASE_URL).replace(/\/+$/, "") + "/" +
    encodeURIComponent(safeName);
}


async function fetchRemoteImageBuffer(fetchImpl, url, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "JOHNTRAN-JS-STK" }
    });
    if (!response || !response.ok) {
      const status = Number(response && response.status || 0);
      throw new Error("HTTP " + (status || "không xác định"));
    }

    const contentLength = Number(response.headers && response.headers.get
      ? response.headers.get("content-length") || 0 : 0);
    if (contentLength > maxBytes) {
      throw new Error("Tệp nguồn vượt giới hạn " + maxBytes + " byte.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > maxBytes) {
      throw new Error("Tệp tải về rỗng hoặc vượt giới hạn " + maxBytes + " byte.");
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureRemoteAsset(fileName, options = {}) {
  const safeName = String(fileName || "");
  const url = buildRawAssetUrl(safeName, options.rawBaseUrl || RAW_BASE_URL);
  const directory = path.resolve(options.directory || DECOR_DIR);
  const targetPath = path.join(directory, safeName);
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_DECORATION_BYTES;
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_CACHE_TTL_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : REMOTE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || global.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Node.js hiện tại không hỗ trợ fetch để tải tài nguyên STK từ GitHub.");
  }
  await fs.promises.mkdir(directory, { recursive: true });

  let cachedStat = null;
  try {
    cachedStat = await fs.promises.stat(targetPath);
    if (!cachedStat.isFile() || cachedStat.size <= 0 || cachedStat.size > maxBytes) {
      cachedStat = null;
    }
  } catch {
    cachedStat = null;
  }

  const hasUsableCache = Boolean(cachedStat);
  const isFresh = hasUsableCache && ttlMs > 0 &&
    (Date.now() - cachedStat.mtimeMs) < ttlMs;
  if (isFresh) return targetPath;

  const cacheKey = directory + "::" + safeName;
  const existingDownload = remoteDownloads.get(cacheKey);
  if (existingDownload) return existingDownload;

  const pending = (async () => {
    try {
      const buffer = await fetchRemoteImageBuffer(
        fetchImpl, url, timeoutMs, maxBytes
      );
      if (!isValidImageBuffer(buffer, safeName)) {
        throw new Error("Dữ liệu tải về không đúng định dạng ảnh " +
          path.extname(safeName) + ".");
      }

      const temporaryPath = targetPath + ".tmp-" + process.pid + "-" +
        crypto.randomBytes(5).toString("hex");
      try {
        await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx" });
        await fs.promises.rename(temporaryPath, targetPath);
      } finally {
        try { await fs.promises.rm(temporaryPath, { force: true }); } catch {}
      }
      return targetPath;
    } catch (error) {
      if (hasUsableCache) {
        console.warn("[stk] GitHub raw không truy cập được; dùng cache cũ " +
          safeName + ": " + String(error && error.message || error));
        return targetPath;
      }
      const wrapped = new Error(
        "Không tải được " + safeName + " từ kho Discord-decor trên GitHub (" +
        url + "): " + String(error && error.message || error)
      );
      wrapped.code = "STK_REMOTE_ASSET_DOWNLOAD_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  })();

  remoteDownloads.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    if (remoteDownloads.get(cacheKey) === pending) remoteDownloads.delete(cacheKey);
  }
}

function ensureDecorationFile(id, options = {}) {
  const decoration = getDecoration(id);
  if (!decoration) {
    return Promise.reject(new RangeError("Số thứ tự khung phải từ 1 đến 200."));
  }
  return ensureRemoteAsset(decoration.file, {
    ...options,
    maxBytes: Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_DECORATION_BYTES
  });
}

function ensureMenuFile(options = {}) {
  return ensureRemoteAsset("menu.jpg", {
    ...options,
    maxBytes: Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_MENU_BYTES
  });
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
  // Composite RGB separately from alpha. FFmpeg's overlay auto format can
  // discard alpha on some builds, so reconstruct an explicit union mask:
  // avatar circle OR the Discord frame's original alpha channel.
  const center = OFFSET + AVATAR_SIZE / 2;
  const circleMask =
    "255*max(0\\,min(1\\," + AVATAR_SIZE / 2 + "-hypot(X-" + center +
    "\\,Y-" + center + ")))";
  return [
    "[0:v]scale=" + AVATAR_SIZE + ":" + AVATAR_SIZE +
      ":force_original_aspect_ratio=increase:flags=lanczos," +
      "crop=" + AVATAR_SIZE + ":" + AVATAR_SIZE +
      ",setsar=1,format=rgba[avatar]",
    "[1:v]scale=" + CANVAS_SIZE + ":" + CANVAS_SIZE +
      ":force_original_aspect_ratio=decrease:flags=lanczos," +
      "pad=" + CANVAS_SIZE + ":" + CANVAS_SIZE +
      ":(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,format=rgba," +
      "split=2[decorColor][decorAlphaSource]",
    "[2:v]format=rgb24[base]",
    "[base][avatar]overlay=" + OFFSET + ":" + OFFSET + ":format=auto[stage]",
    "[stage][decorColor]overlay=0:0:format=auto,format=rgb24,fps=" + fps + "[rgb]",
    "nullsrc=s=" + CANVAS_SIZE + "x" + CANVAS_SIZE + ":r=" + fps +
      ",format=gray,geq=lum='" + circleMask + "'[circle]",
    "[decorAlphaSource]alphaextract,format=gray[decorAlpha]",
    "[circle][decorAlpha]blend=all_mode=lighten[mask]",
    "[rgb][mask]alphamerge,format=yuva420p[out]"
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
  if (!(await stickerService.hasWebpEncoder())) {
    throw new Error(
      "Render chưa có FFmpeg hỗ trợ libwebp. Bot đã thử cả ffmpeg-static và FFmpeg hệ thống; " +
      "hãy kiểm tra package ffmpeg-static và cấu hình deploy."
    );
  }
  const binary = stickerService.resolveFfmpegBinary();

  const overlayBuffer = fs.readFileSync(decorationPath);
  if (!overlayBuffer.length || overlayBuffer.length > MAX_DECORATION_BYTES) {
    throw new Error("Tệp khung Discord rỗng hoặc vượt giới hạn 10 MB.");
  }

  const sourceAnimated = isAnimatedBuffer(sourceBuffer, sourceExtension);
  const overlayAnimated = isAnimatedBuffer(overlayBuffer, path.extname(decorationPath));
  const animated = sourceAnimated || overlayAnimated;
  // 288px stickers usually fit on the first encode; only retry once with a
  // lighter profile instead of spending minutes across five encodes.
  const profiles = [
    { fps: 10, quality: 38 },
    { fps: 7, quality: 26 }
  ];
  let lastError = null;
  for (const profile of profiles) {
    const outputPath = makeTempName("stk_dis", ".webp");
    const filter = buildFilterGraph(profile.fps);
    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputArgs(sourcePath, sourceExtension, sourceAnimated, profile.fps),
      ...inputArgs(decorationPath, path.extname(decorationPath), overlayAnimated, profile.fps),
      "-f", "lavfi", "-i",
      "color=c=black:s=" + CANVAS_SIZE + "x" + CANVAS_SIZE + ":r=" + profile.fps,
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
      "-threads", "2",
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
  const totalStartedAt = Date.now();
  if (!api || !event?.threadId) throw new Error("Thiếu thông tin cuộc trò chuyện để gửi sticker.");
  const decoration = getDecoration(decorationId);
  if (!decoration) throw new RangeError("Khung Discord phải nằm trong khoảng 1–200.");

  const normalizedUrl = stickerService.normalizeSourceUrl(mediaUrl);
  if (!normalizedUrl) throw new Error("Không tìm thấy URL ảnh/sticker hợp lệ.");

  stickerService.registerStickerApi(api);
  fs.mkdirSync(TMP_DIR, { recursive: true });

  let sourcePath = null;
  let outputPath = null;
  try {
    // Download the selected frame and the user's media in parallel.
    const downloadStartedAt = Date.now();
    const [decorationPath, source] = await Promise.all([
      ensureDecorationFile(decorationId),
      stickerService.fetchSource(api, normalizedUrl)
    ]);
    const downloadMs = Date.now() - downloadStartedAt;
    const extension = stickerService.sourceExtension(normalizedUrl, source.contentType, source.buffer);
    if (extension === ".bin") {
      throw new Error("Không nhận diện được định dạng ảnh/video. Hỗ trợ PNG, JPG, GIF, WebP, MP4, MOV và WebM.");
    }

    sourcePath = makeTempName("stk_source", extension);
    fs.writeFileSync(sourcePath, source.buffer);

    const renderStartedAt = Date.now();
    const output = await createWebp(sourcePath, source.buffer, extension, decorationPath);
    const renderMs = Date.now() - renderStartedAt;
    outputPath = output.path;

    if (typeof api.uploadStickerImage !== "function" ||
        typeof api.sendCustomStickerUrl !== "function") {
      throw new Error("Phiên Zalo chưa khởi tạo API upload/send sticker. Hãy khởi động lại bot.");
    }

    const uploadStartedAt = Date.now();
    const uploaded = await api.uploadStickerImage({
      filePath: outputPath,
      threadId: event.threadId,
      threadType: event.type
    });
    const uploadMs = Date.now() - uploadStartedAt;
    const cdnUrl = extractUploadedUrl(uploaded);
    if (!cdnUrl) throw new Error("Zalo không trả về URL CDN sau khi upload sticker.");

    const quote = getReplyQuote(event);
    const sendStartedAt = Date.now();
    const sent = await api.sendCustomStickerUrl({
      staticImgUrl: stickerService.buildStickerUrl(String(cdnUrl), true),
      animationImgUrl: stickerService.buildStickerUrl(String(cdnUrl), true),
      threadId: event.threadId,
      threadType: event.type,
      reply: quote?.msgId || null,
      width: output.width,
      height: output.height
    });
    const sendMs = Date.now() - sendStartedAt;
    const totalMs = Date.now() - totalStartedAt;

    console.info(
      "[stk] completed #" + decorationId +
      " download=" + downloadMs + "ms render=" + renderMs +
      "ms upload=" + uploadMs + "ms send=" + sendMs + "ms total=" + totalMs + "ms"
    );
    return { ...output, response: sent, decoration, timings: { downloadMs, renderMs, uploadMs, sendMs, totalMs } };
  } finally {
    for (const filePath of [sourcePath, outputPath]) {
      if (!filePath) continue;
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
  }
}

module.exports = {
  RAW_BASE_URL,
  DECOR_DIR,
  TMP_DIR,
  CANVAS_SIZE,
  AVATAR_SIZE,
  OFFSET,
  MAX_OUTPUT_BYTES,
  MAX_DECORATION_BYTES,
  MAX_MENU_BYTES,
  DEFAULT_CACHE_TTL_MS,
  catalog,
  getDecoration,
  resolveDecorationFile,
  findDecorationFile,
  getAssetStatus,
  isValidImageBuffer,
  buildRawAssetUrl,
  ensureRemoteAsset,
  ensureDecorationFile,
  ensureMenuFile,
  isAnimatedBuffer,
  inputArgs,
  buildFilterGraph,
  createWebp,
  extractUploadedUrl,
  processDiscordSticker
};
