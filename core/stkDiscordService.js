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

  const downloadAndCache = async () => {
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
  };

  // A valid local frame is always usable. Refresh expired cache in the
  // background so a slow Raw GitHub response never blocks sticker rendering.
  if (hasUsableCache) {
    if (!existingDownload) {
      let refresh;
      refresh = (async () => {
        try {
          await downloadAndCache();
        } catch (error) {
          console.warn("[stk] Không làm mới được cache GitHub; tiếp tục dùng " +
            "khung đã lưu " + safeName + ": " +
            String(error && error.message || error));
        } finally {
          if (remoteDownloads.get(cacheKey) === refresh) {
            remoteDownloads.delete(cacheKey);
          }
        }
      })();
      remoteDownloads.set(cacheKey, refresh);
    }
    return targetPath;
  }

  if (existingDownload) return existingDownload;

  const pending = (async () => {
    try {
      return await downloadAndCache();
    } catch (error) {
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

function runFfmpeg(binary, args, timeout = 20000) {
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


/**
 * Fast path for a static avatar + static PNG decoration.
 * Canvas composites one 288px frame in-process, avoiding an FFmpeg spawn.
 * Returns null when the PNG would exceed Zalo's sticker size limit so the
 * normal WebP encoder can still handle/compress it.
 */
async function createStaticPng(sourceBuffer, decorationBufferOrPath) {
  const { createCanvas, loadImage } = require("canvas");
  const decorationBuffer = Buffer.isBuffer(decorationBufferOrPath)
    ? decorationBufferOrPath
    : fs.readFileSync(decorationBufferOrPath);
  const [avatar, frame] = await Promise.all([
    loadImage(sourceBuffer),
    loadImage(decorationBuffer)
  ]);

  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Match the Discord crop: cover the 240px avatar slot and clip it to a circle.
  const avatarScale = Math.max(AVATAR_SIZE / avatar.width, AVATAR_SIZE / avatar.height);
  const avatarWidth = avatar.width * avatarScale;
  const avatarHeight = avatar.height * avatarScale;
  const avatarX = OFFSET + (AVATAR_SIZE - avatarWidth) / 2;
  const avatarY = OFFSET + (AVATAR_SIZE - avatarHeight) / 2;
  context.save();
  context.beginPath();
  context.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  context.clip();
  context.drawImage(avatar, avatarX, avatarY, avatarWidth, avatarHeight);
  context.restore();

  // Keep the frame's aspect ratio and transparent padding, as in the FFmpeg path.
  const frameScale = Math.min(CANVAS_SIZE / frame.width, CANVAS_SIZE / frame.height);
  const frameWidth = frame.width * frameScale;
  const frameHeight = frame.height * frameScale;
  context.drawImage(
    frame,
    (CANVAS_SIZE - frameWidth) / 2,
    (CANVAS_SIZE - frameHeight) / 2,
    frameWidth,
    frameHeight
  );

  const buffer = canvas.toBuffer("image/png", { compressionLevel: 1 });
  if (!buffer.length || buffer.length > MAX_OUTPUT_BYTES) return null;

  const outputPath = makeTempName("stk_dis_fast", ".png");
  fs.writeFileSync(outputPath, buffer);
  return {
    path: outputPath,
    buffer,
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    size: buffer.length,
    animated: false,
    format: "png",
    renderer: "canvas-static"
  };
}

function extractUploadedUrl(uploaded) {
  const root = uploaded && typeof uploaded === "object" ? uploaded : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data : root;
  return data.normalUrl || data.hdUrl || data.thumbUrl || data.fileUrl ||
    data.url || data.oriUrl || root.normalUrl || root.hdUrl ||
    root.thumbUrl || root.fileUrl || root.url || null;
}


const RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RESULT_CACHE_MAX_ENTRIES = 2000;
const DEFAULT_RESULT_CACHE_FILE = path.join(DECOR_DIR, "results-v1.json");

function createResultCacheKey(mediaUrl, decorationId) {
  const normalizedUrl = stickerService.normalizeSourceUrl(mediaUrl);
  if (!normalizedUrl) throw new Error("Không tạo được khóa cache STK từ URL media.");
  return crypto.createHash("sha256")
    .update("stk-discord-v1\0" + String(decorationId) + "\0" + normalizedUrl)
    .digest("hex");
}


const AVATAR_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;

function createIdentityResultCacheKey(identity, decorationId) {
  const value = String(identity || "").trim();
  if (!value) throw new Error("Thiếu định danh để tạo cache avatar STK.");
  return crypto.createHash("sha256")
    .update("stk-discord-identity-v1\\0" + String(decorationId) + "\\0" + value)
    .digest("hex");
}

function readResultCacheStore(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (data?.version === 1 && data.entries && typeof data.entries === "object") {
      return data;
    }
  } catch {}
  return { version: 1, entries: {} };
}

function isSafeCachedCdnUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function readStickerResultCache(key, options = {}) {
  const filePath = options.filePath || DEFAULT_RESULT_CACHE_FILE;
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : RESULT_CACHE_TTL_MS;
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const store = readResultCacheStore(filePath);
  const entry = store.entries[String(key)];
  if (!entry || !isSafeCachedCdnUrl(entry.cdnUrl)) return null;
  if (!Number.isFinite(entry.cachedAt) || nowMs - entry.cachedAt > ttlMs || nowMs < entry.cachedAt) {
    return null;
  }
  return {
    cdnUrl: entry.cdnUrl,
    format: entry.format === "webp" ? "webp" : "png",
    width: Number(entry.width) || CANVAS_SIZE,
    height: Number(entry.height) || CANVAS_SIZE,
    animated: entry.animated === true,
    cachedAt: entry.cachedAt
  };
}

function writeStickerResultCache(key, value, options = {}) {
  if (!value || !isSafeCachedCdnUrl(value.cdnUrl)) return false;
  const filePath = options.filePath || DEFAULT_RESULT_CACHE_FILE;
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const store = readResultCacheStore(filePath);
  store.entries[String(key)] = {
    cdnUrl: String(value.cdnUrl),
    format: value.format === "webp" ? "webp" : "png",
    width: Number(value.width) || CANVAS_SIZE,
    height: Number(value.height) || CANVAS_SIZE,
    animated: value.animated === true,
    cachedAt: nowMs
  };

  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : RESULT_CACHE_TTL_MS;
  const valid = Object.entries(store.entries)
    .filter(([, entry]) =>
      entry && isSafeCachedCdnUrl(entry.cdnUrl) &&
      Number.isFinite(entry.cachedAt) &&
      nowMs >= entry.cachedAt &&
      nowMs - entry.cachedAt <= ttlMs
    )
    .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
    .slice(0, RESULT_CACHE_MAX_ENTRIES);
  store.entries = Object.fromEntries(valid);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(tempPath, JSON.stringify(store));
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  }
  return true;
}

function deleteStickerResultCache(key, options = {}) {
  const filePath = options.filePath || DEFAULT_RESULT_CACHE_FILE;
  const store = readResultCacheStore(filePath);
  if (!Object.prototype.hasOwnProperty.call(store.entries, String(key))) return false;
  delete store.entries[String(key)];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  try {
    fs.writeFileSync(tempPath, JSON.stringify(store));
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  }
  return true;
}

function isExpiredCdnError(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return status === 404 || /HTTP\s*404|\b404\b|not found|expired|hết hạn/i.test(
    String(error?.message || error || "")
  );
}

async function measureStage(name, operation, timings) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    timings[name] = Date.now() - startedAt;
    console.info("[stk] " + name + "=" + timings[name] + "ms");
    return result;
  } catch (error) {
    timings[name] = Date.now() - startedAt;
    console.warn("[stk] " + name + " failed after " + timings[name] +
      "ms: " + String(error && error.message || error));
    throw error;
  }
}

async function processDiscordSticker({ api, event, mediaUrl, decorationId, resultCacheFile: resultCacheFileOverride, cacheIdentity }) {
  const totalStartedAt = Date.now();
  const timings = {};
  let sourcePath = null;
  let outputPath = null;
  let currentStage = "validate";

  try {
    if (!api || !event?.threadId) throw new Error("Thiếu thông tin cuộc trò chuyện để gửi sticker.");
    const decoration = getDecoration(decorationId);
    if (!decoration) throw new RangeError("Khung Discord phải nằm trong khoảng 1–200.");

    const normalizedUrl = stickerService.normalizeSourceUrl(mediaUrl);
    if (!normalizedUrl) throw new Error("Không tìm thấy URL ảnh/sticker hợp lệ.");

    currentStage = "register-api";
    stickerService.registerStickerApi(api);
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // A composition already uploaded to Zalo can be re-sent using one API
    // call. This is the only practical sub-second path after the first build.
    const resultCacheFile = resultCacheFileOverride || DEFAULT_RESULT_CACHE_FILE;
    const resultCacheKey = createResultCacheKey(normalizedUrl, decorationId);
    const identityCacheKey = cacheIdentity
      ? createIdentityResultCacheKey(cacheIdentity, decorationId)
      : null;
    const cachedResult = readStickerResultCache(resultCacheKey, {
      filePath: resultCacheFile
    }) || (identityCacheKey
      ? readStickerResultCache(identityCacheKey, {
        filePath: resultCacheFile,
        ttlMs: AVATAR_RESULT_CACHE_TTL_MS
      })
      : null);
    if (cachedResult && typeof api.sendCustomStickerUrl === "function") {
      currentStage = "zalo-send-cache";
      try {
        const cachedSent = await measureStage("cacheSend", () => api.sendCustomStickerUrl({
          staticImgUrl: stickerService.buildStickerUrl(cachedResult.cdnUrl, cachedResult.format === "webp"),
          animationImgUrl: stickerService.buildStickerUrl(cachedResult.cdnUrl, cachedResult.format === "webp"),
          threadId: event.threadId,
          threadType: event.type,
          reply: getReplyQuote(event)?.msgId || null,
          width: cachedResult.width,
          height: cachedResult.height
        }), timings);
        timings.totalMs = Date.now() - totalStartedAt;
        console.info(
          "[stk] completed #" + decorationId +
          " resultCache=HIT cacheSend=" + timings.cacheSend + "ms" +
          " total=" + timings.totalMs + "ms"
        );
        return {
          path: null,
          width: cachedResult.width,
          height: cachedResult.height,
          size: 0,
          animated: cachedResult.animated,
          format: cachedResult.format,
          cached: true,
          response: cachedSent,
          decoration,
          timings
        };
      } catch (error) {
        if (!isExpiredCdnError(error)) throw error;
        deleteStickerResultCache(resultCacheKey, { filePath: resultCacheFile });
        console.warn("[stk] CDN cache cũ không còn tồn tại; tạo lại sticker.");
      }
    }

    // Determine whether the selected frame is already on Persistent Disk.
    // Frame cache lookup and avatar/media retrieval run concurrently.
    const frameCacheHit = Boolean(resolveDecorationFile(decorationId));
    currentStage = "parallel-download";
    const downloadStartedAt = Date.now();
    const [decorationPath, source] = await Promise.all([
      measureStage(
        frameCacheHit ? "frameCache" : "frameDownload",
        () => ensureDecorationFile(decorationId),
        timings
      ),
      measureStage(
        "mediaDownload",
        () => stickerService.fetchSource(api, normalizedUrl),
        timings
      )
    ]);
    timings.parallelDownloadMs = Date.now() - downloadStartedAt;

    const extension = stickerService.sourceExtension(normalizedUrl, source.contentType, source.buffer);
    if (extension === ".bin") {
      throw new Error("Không nhận diện được định dạng ảnh/video. Hỗ trợ PNG, JPG, GIF, WebP, MP4, MOV và WebM.");
    }

    const frameBuffer = fs.readFileSync(decorationPath);
    const staticFastPath =
      /\.(png|jpe?g)$/i.test(extension) &&
      !isAnimatedBuffer(source.buffer, extension) &&
      /\.png$/i.test(path.extname(decorationPath)) &&
      !isAnimatedBuffer(frameBuffer, path.extname(decorationPath));

    currentStage = staticFastPath ? "canvas-static" : "ffmpeg";
    const output = await measureStage("render", async () => {
      if (staticFastPath) {
        try {
          const fastOutput = await createStaticPng(source.buffer, frameBuffer);
          if (fastOutput) {
            console.info("[stk] renderer=canvas-static");
            return fastOutput;
          }
          console.warn("[stk] Canvas PNG vượt giới hạn; chuyển sang WebP encoder.");
        } catch (error) {
          console.warn("[stk] Canvas fast path không dùng được; chuyển sang FFmpeg: " +
            String(error && error.message || error));
        }
      }

      sourcePath = makeTempName("stk_source", extension);
      fs.writeFileSync(sourcePath, source.buffer);
      return createWebp(sourcePath, source.buffer, extension, decorationPath);
    }, timings);
    outputPath = output.path;

    if (typeof api.uploadStickerImage !== "function" ||
        typeof api.sendCustomStickerUrl !== "function") {
      throw new Error("Phiên Zalo chưa khởi tạo API upload/send sticker. Hãy khởi động lại bot.");
    }

    currentStage = "zalo-upload";
    const uploaded = await measureStage("zaloUpload", () => api.uploadStickerImage({
      filePath: outputPath,
      threadId: event.threadId,
      threadType: event.type
    }), timings);
    const cdnUrl = extractUploadedUrl(uploaded);
    if (!cdnUrl) throw new Error("Zalo không trả về URL CDN sau khi upload sticker.");

    // Persist the personalized CDN URL before sending so a subsequent command
    // can skip both rendering and the upload request.
    try {
      const cacheValue = {
        cdnUrl,
        format: output.format,
        width: output.width,
        height: output.height,
        animated: output.animated
      };
      writeStickerResultCache(resultCacheKey, cacheValue, { filePath: resultCacheFile });
      if (identityCacheKey) {
        // Short-lived UID alias lets the next avatar command skip profile lookup.
        writeStickerResultCache(identityCacheKey, cacheValue, { filePath: resultCacheFile });
      }
    } catch (error) {
      console.warn("[stk] Không lưu được cache kết quả Zalo: " +
        String(error && error.message || error));
    }

    const quote = getReplyQuote(event);
    currentStage = "zalo-send";
    const sent = await measureStage("zaloSend", () => api.sendCustomStickerUrl({
      staticImgUrl: stickerService.buildStickerUrl(String(cdnUrl), output.format === "webp"),
      animationImgUrl: stickerService.buildStickerUrl(String(cdnUrl), output.format === "webp"),
      threadId: event.threadId,
      threadType: event.type,
      reply: quote?.msgId || null,
      width: output.width,
      height: output.height
    }), timings);

    timings.totalMs = Date.now() - totalStartedAt;
    console.info(
      "[stk] completed #" + decorationId +
      " frameCache=" + (frameCacheHit ? "HIT" : "MISS") +
      " parallelDownload=" + timings.parallelDownloadMs + "ms" +
      " frameCache=" + (timings.frameCache ?? "-") + "ms" +
      " frameDownload=" + (timings.frameDownload ?? "-") + "ms" +
      " mediaDownload=" + timings.mediaDownload + "ms" +
      " render=" + timings.render + "ms" +
      " renderer=" + (output.renderer || (output.format === "webp" ? "ffmpeg-webp" : "png")) +
      " upload=" + timings.zaloUpload + "ms" +
      " send=" + timings.zaloSend + "ms" +
      " total=" + timings.totalMs + "ms"
    );
    return { ...output, response: sent, decoration, timings };
  } catch (error) {
    timings.totalMs = Date.now() - totalStartedAt;
    console.error(
      "[stk] failed #" + decorationId +
      " stage=" + currentStage +
      " timings=" + JSON.stringify(timings) +
      " total=" + timings.totalMs + "ms: " +
      String(error && error.stack || error)
    );
    throw error;
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
  createStaticPng,
  extractUploadedUrl,
  createResultCacheKey,
  createIdentityResultCacheKey,
  AVATAR_RESULT_CACHE_TTL_MS,
  readStickerResultCache,
  writeStickerResultCache,
  deleteStickerResultCache,
  RESULT_CACHE_TTL_MS,
  processDiscordSticker
};
