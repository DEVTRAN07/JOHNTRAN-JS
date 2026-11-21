"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const http = require("./http");
const { FFMPEG_THREADS } = require("./mediaResourceLimits");
const native = require("../native");
const STICKER_SIZE = 512;
const decorations = require("./stickerDecorations");

const UPLOAD_HOST = "https://tt-files-wpa.chat.zalo.me";
const UPLOAD_USER_PATH = "/api/message/photo_original/upload";
const UPLOAD_GROUP_PATH = "/api/group/photo_original/upload";
const SEND_USER_PATH = "/api/message/photo_url";
const SEND_GROUP_PATH = "/api/group/photo_url";
const STICKER_SUFFIX = "?sticker.webp";
const CACHE_DIR = path.join(__dirname, "..", "assets", "cache", "sticker");
const DECORATION_ASSET_CACHE_DIR = path.join(CACHE_DIR, "decorations");
const MAX_DECORATION_BYTES = 10 * 1024 * 1024;
const DECORATION_ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const MAX_ANIMATION_SECONDS = 8;
const FPS = 12;
const ZALO_MEDIA_HOST_RE = /(^|\.)(zdn\.vn|dlfl\.vn|zadn\.vn|zaloapp\.com|zalo\.me|zalo\.ai)$/i;

let webpEncoderCache = null;

function now() {
  return Date.now();
}

function uniqueName(prefix, extension) {
  return prefix + "_" + process.pid + "_" + now() + "_" + crypto.randomBytes(4).toString("hex") + extension;
}

function isZaloMediaUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" && ZALO_MEDIA_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeSourceUrl(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanMediaUrl(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\?sticker\.webp.*$/i, "")
    .replace(/\?Sticker_by_.*$/i, "")
    .trim();
}

function pickMediaUrl(media) {
  if (!media) return null;
  return cleanMediaUrl(media.webpUrl) || cleanMediaUrl(media.video) ||
    cleanMediaUrl(media.image) || cleanMediaUrl(media.file) || null;
}

function sourceExtension(url, contentType, buffer) {
  const magic = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
  if (magic.subarray(0, 6).toString() === "GIF87a" || magic.subarray(0, 6).toString() === "GIF89a") return ".gif";
  if (magic[0] === 0x89 && magic.subarray(1, 4).toString() === "PNG") return ".png";
  if (magic.subarray(0, 4).toString() === "RIFF" && magic.subarray(8, 12).toString() === "WEBP") return ".webp";
  if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) return ".jpg";
  if (magic.length > 8 && magic.subarray(4, 8).toString() === "ftyp") return ".mp4";
  if (magic.subarray(0, 4).toString("hex") === "1a45dfa3") return ".webm";

  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  const byType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov"
  };
  if (byType[type]) return byType[type];

  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)$/.test(extension)) {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
  } catch {}
  return ".bin";
}

function getPackagedFfmpegPath() {
  try { return require("ffmpeg-static"); } catch { return null; }
}

function resolveFfmpegBinary(staticPath) {
  if (staticPath === undefined && verifiedFfmpegBinary) return verifiedFfmpegBinary;

  const packaged = staticPath === undefined ? getPackagedFfmpegPath() : staticPath;
  for (const candidate of [process.env.FFMPEG_PATH, packaged, "ffmpeg"]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const resolved = candidate.trim();
    if (!path.isAbsolute(resolved)) return resolved;
    try {
      fs.accessSync(resolved, fs.constants.X_OK);
      return resolved;
    } catch {}
  }
  return "ffmpeg";
}

let verifiedFfmpegBinary = null;
let FFMPEG = resolveFfmpegBinary();

function execFfmpeg(args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = String(stderr || "");
        error.stdout = String(stdout || "");
        return reject(error);
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function hasWebpEncoder() {
  if (webpEncoderCache === true) return true;

  const candidates = [
    FFMPEG,
    process.env.FFMPEG_PATH,
    getPackagedFfmpegPath(),
    "ffmpeg"
  ].filter((candidate, index, all) =>
    typeof candidate === "string" &&
    candidate.trim() &&
    all.indexOf(candidate) === index
  );

  for (const candidate of candidates) {
    try {
      const result = await new Promise((resolve, reject) => {
        execFile(candidate, ["-hide_banner", "-encoders"], {
          timeout: 15000,
          maxBuffer: 16 * 1024 * 1024
        }, (error, stdout, stderr) => {
          if (error) {
            error.stderr = String(stderr || "");
            reject(error);
            return;
          }
          resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
        });
      });
      if (!/\blibwebp\b/.test(result.stdout + result.stderr)) continue;

      FFMPEG = candidate;
      verifiedFfmpegBinary = candidate;
      webpEncoderCache = true;
      return true;
    } catch {
      // Try the next candidate: the system binary may be missing or lack WebP.
    }
  }

  webpEncoderCache = false;
  return false;
}

async function fetchSource(api, url) {
  if (isZaloMediaUrl(url)) {
    if (typeof api?.fetchZaloMedia !== "function") {
      throw new Error("Phiên Zalo chưa đăng ký bộ tải media sticker. Hãy khởi động lại bot.");
    }
    const result = await api.fetchZaloMedia({ url });
    const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || []);
    if (buffer.length < 64) throw new Error("Media Zalo tải về rỗng hoặc quá nhỏ.");
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error("Media vượt giới hạn 20 MB.");
    return { buffer, contentType: result.contentType || "" };
  }

  const response = await http.getBuffer(url, { timeout: 20000, retries: 0 });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("Không tải được media (HTTP " + response.status + ").");
  }
  if (!Buffer.isBuffer(response.buffer) || response.buffer.length < 64) {
    throw new Error("Media tải về rỗng hoặc quá nhỏ.");
  }
  if (response.buffer.length > MAX_SOURCE_BYTES) throw new Error("Media vượt giới hạn 20 MB.");
  return { buffer: response.buffer, contentType: response.contentType || "" };
}

async function tryRustStaticCircleSticker(inputPath, overlayPath, outputBasePath, profiles) {
  if (process.env.JT_RUST_STICKER_COMPOSITOR === "0" ||
      typeof native.composeStaticCircleSticker !== "function") return null;

  const sourceExtension = path.extname(inputPath).toLowerCase();
  const overlayExtension = path.extname(overlayPath).toLowerCase();
  const supportedSource = [".png", ".jpg", ".jpeg"].includes(sourceExtension);
  const supportedOverlay = [".png", ".jpg", ".jpeg"].includes(overlayExtension);
  if (!supportedSource || !supportedOverlay) return null;

  const [source, overlay] = await Promise.all([
    fs.promises.readFile(inputPath),
    fs.promises.readFile(overlayPath)
  ]);
  if (!source.length || source.length > MAX_SOURCE_BYTES ||
      !overlay.length || overlay.length > MAX_DECORATION_BYTES) return null;

  for (const profile of profiles) {
    const result = await native.composeStaticCircleSticker({
      source,
      overlay,
      size: profile.size,
      quality: profile.quality
    });
    if (!result) return null;

    const buffer = Buffer.isBuffer(result.buffer)
      ? result.buffer
      : Buffer.from(result.buffer || []);
    const validDimensions = Number(result.width) === profile.size &&
      Number(result.height) === profile.size;
    if (!buffer.length || !validDimensions || result.format !== "webp") return null;
    if (buffer.length > MAX_STICKER_BYTES) continue;

    const outputPath = outputBasePath + profile.size + ".webp";
    await fs.promises.writeFile(outputPath, buffer);
    return {
      path: outputPath,
      buffer,
      width: profile.size,
      height: profile.size,
      format: "webp",
      animated: false,
      shape: "circle",
      transparent: true,
      size: buffer.length,
      engine: "rust"
    };
  }

  // If Rust cannot produce a sticker under the Zalo size cap, let the existing
  // FFmpeg profile ladder try the same input rather than failing the command.
  return null;
}

async function convertMedia(inputPath, overlayPath, outputBasePath, options = {}) {
  const isStaticInput = !/\.(gif|webp|mp4|webm|mov|m4v)$/i.test(inputPath);
  const overlayAnimated = options.overlayAnimated === true;
  const outputAnimated = !isStaticInput || overlayAnimated;
  const profiles = [
    { size: 512, fps: FPS, quality: 68 },
    { size: 480, fps: 10, quality: 55 },
    { size: 400, fps: 9, quality: 43 },
    { size: 320, fps: 8, quality: 34 },
    { size: 256, fps: 7, quality: 27 }
  ];
  let lastError = null;

  // Still PNG/JPG pairs can be composited and encoded by Rust without
  // spawning FFmpeg. Animated GIF/WebP/video continues through the old path.
  if (isStaticInput && !overlayAnimated) {
    const rustResult = await tryRustStaticCircleSticker(inputPath, overlayPath, outputBasePath, profiles);
    if (rustResult) return rustResult;
  }

  const webp = await hasWebpEncoder();
  for (const profile of profiles) {
    const extension = webp ? ".webp" : ".gif";
    const outputPath = outputBasePath + profile.size + extension;
    const size = profile.size;
    const baseInput = isStaticInput
      ? ["-loop", "1", "-framerate", String(profile.fps), "-i", inputPath]
      : ["-i", inputPath];
    const overlayInput = overlayAnimated
      ? ["-stream_loop", "-1", "-i", overlayPath]
      : ["-loop", "1", "-framerate", String(profile.fps), "-i", overlayPath];
    // Keep a square transport canvas for Zalo, but make the actual sticker a
    // true circle. The one-pixel alpha ramp smooths the edge without a halo.
    const circleAlpha =
      "alpha(X,Y)*max(0\\,min(1\\,min(W\\,H)/2-hypot(X-W/2\\,Y-H/2)))";
    const baseFilter =
      "[0:v]scale=" + size + ":" + size + ":force_original_aspect_ratio=increase:flags=lanczos," +
      "crop=" + size + ":" + size + ",setsar=1[base];" +
      "[1:v]scale=" + size + ":" + size + ":flags=lanczos,format=rgba[frame];" +
      "[base][frame]overlay=0:0:format=auto,format=rgba," +
      "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='" + circleAlpha + "',fps=" +
      profile.fps + "[circle]";
    const filter = webp
      ? baseFilter + ";[circle]format=yuva420p[sticker]"
      : baseFilter + ";[circle]split[anim][paletteSource];" +
        "[paletteSource]palettegen=stats_mode=diff[palette];" +
        "[anim][palette]paletteuse=dither=sierra2_4a[sticker]";

    const args = [
      "-hide_banner", "-loglevel", "error", "-y",
      ...baseInput,
      ...overlayInput,
      "-filter_complex_threads", String(FFMPEG_THREADS),
      "-filter_complex", filter,
      "-map", "[sticker]",
      "-an"
    ];
    if (outputAnimated) args.push("-t", String(MAX_ANIMATION_SECONDS));
    else args.push("-frames:v", "1");
    args.push("-threads", String(FFMPEG_THREADS));
    if (webp) {
      args.push("-c:v", "libwebp", "-lossless", "0", "-q:v", String(profile.quality),
        "-compression_level", "4", "-preset", "picture", "-loop", "0");
    } else {
      args.push("-loop", "0");
    }
    args.push(outputPath);

    try {
      await execFfmpeg(args, 180000);
      const stat = fs.statSync(outputPath);
      if (stat.size <= MAX_STICKER_BYTES) {
        return {
          path: outputPath,
          buffer: fs.readFileSync(outputPath),
          width: size,
          height: size,
          format: webp ? "webp" : "gif",
          animated: outputAnimated,
          shape: "circle",
          transparent: true,
          size: stat.size,
          engine: "ffmpeg"
        };
      }
      lastError = new Error("Sticker đang lớn hơn giới hạn 512 KB sau khi nén.");
    } catch (error) {
      lastError = new Error("FFmpeg không thể ghép khung Discord: " + String(error.stderr || error.message).slice(-500));
    }
    try { fs.rmSync(outputPath, { force: true }); } catch {}
  }

  throw lastError || new Error("Không thể tạo sticker Discord.");
}

function isAllowedDecorationAssetUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (parsed.protocol !== "https:" || !/\.(png|gif|webp|apng)$/i.test(parsed.pathname)) return false;
    if (parsed.hostname === "cdn.jsdelivr.net") {
      return /^\/gh\/uhidontkno\/DiscordAvatarDecorations@[a-f0-9]{40}\//i.test(parsed.pathname);
    }
    if (parsed.hostname === "raw.githubusercontent.com") {
      return /^\/uhidontkno\/DiscordAvatarDecorations\/[a-f0-9]{40}\//i.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

async function downloadDecorationOverlay(decoration, options = {}) {
  if (!decoration || typeof decoration !== "object") throw new Error("Decoration Discord không hợp lệ.");
  const useAnimation = options.animated === true && Boolean(decoration.animatedUrl);
  const primaryUrl = useAnimation
    ? decoration.animatedUrl
    : (decoration.staticUrl || decoration.animatedUrl);
  const fallbackUrl = useAnimation
    ? (decoration.animatedFallbackUrl || decoration.staticFallbackUrl)
    : (decoration.staticFallbackUrl || decoration.animatedFallbackUrl);
  const candidates = [...new Set([primaryUrl, fallbackUrl].filter(Boolean))];
  if (!candidates.length || candidates.some(url => !isAllowedDecorationAssetUrl(url))) {
    throw new Error("URL decoration không thuộc kho Discord đã cấu hình.");
  }

  const parsed = new URL(primaryUrl);
  const extension = path.extname(parsed.pathname).toLowerCase() || ".png";
  const cacheKey = crypto.createHash("sha1").update(primaryUrl).digest("hex");
  const assetCacheDir = options.cacheDir || DECORATION_ASSET_CACHE_DIR;
  const cachedPath = path.join(assetCacheDir, cacheKey + extension);
  try {
    const stat = fs.statSync(cachedPath);
    if (stat.isFile() && stat.size > 0 && stat.size <= MAX_DECORATION_BYTES &&
      now() - stat.mtimeMs < DECORATION_ASSET_TTL_MS) {
      return {
        path: cachedPath,
        animated: Boolean(useAnimation || /\/apng\//i.test(parsed.pathname) || /\.(gif|webp|apng)$/i.test(extension)),
        cached: true,
        url: primaryUrl
      };
    }
  } catch {}

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Môi trường không hỗ trợ tải ảnh Discord.");
  let buffer = null;
  let selectedUrl = null;
  let lastError = null;
  for (const assetUrl of candidates) {
    try {
      const response = await fetchImpl(assetUrl, {
        headers: { "User-Agent": "JOHNTRAN-JS-sticker-decoration" },
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(15000)
          : undefined
      });
      if (!response?.ok) throw new Error("HTTP " + (response?.status || "?"));
      const declaredLength = Number(response.headers?.get?.("content-length") || 0);
      if (declaredLength > MAX_DECORATION_BYTES) throw new Error("Ảnh decoration vượt giới hạn 10 MB.");
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length || body.length > MAX_DECORATION_BYTES) {
        throw new Error("Ảnh decoration rỗng hoặc vượt giới hạn 10 MB.");
      }

      const isPng = body[0] === 0x89 && body.subarray(1, 4).toString() === "PNG";
      const isGif = body.subarray(0, 6).toString() === "GIF87a" || body.subarray(0, 6).toString() === "GIF89a";
      const isWebp = body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP";
      if (!isPng && !isGif && !isWebp) throw new Error("Tệp tải về không phải ảnh PNG/GIF/WebP hợp lệ.");
      buffer = body;
      selectedUrl = assetUrl;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!buffer) {
    throw new Error("Không tải được ảnh decoration từ CDN chính hoặc nguồn dự phòng: " +
      String(lastError?.message || lastError || "lỗi không xác định").slice(0, 180));
  }

  fs.mkdirSync(assetCacheDir, { recursive: true });
  const tempPath = cachedPath + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, cachedPath);
  const selectedPath = new URL(selectedUrl).pathname;
  return {
    path: cachedPath,
    animated: Boolean(useAnimation || /\/apng\//i.test(selectedPath) || /\.(gif|webp|apng)$/i.test(selectedPath)),
    cached: true,
    url: selectedUrl
  };
}
function resolveUploadHost(ctx) {
  const serviceHost = ctx?.loginInfo?.zpw_service_map_v3?.file?.[0];
  if (typeof serviceHost === "string" && /^https:\/\//i.test(serviceHost)) {
    try { return new URL(serviceHost).origin; } catch {}
  }
  return UPLOAD_HOST;
}

function buildStickerUrl(cdnUrl, forceWebp) {
  let url = String(cdnUrl || "").replace(/\?sticker\.webp.*$/i, "").replace(/\?Sticker_by_.*$/i, "").replace(/\?.*$/, "").trim();
  if (forceWebp) url = url.replace(/\.[a-z0-9]+$/i, ".webp");
  return url + STICKER_SUFFIX;
}

function buildMultipart(fileName, fileBuffer) {
  const boundary = "----JTDiscordSticker" + now().toString(16) + crypto.randomBytes(4).toString("hex");
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"chunkContent\"; filename=\"" + fileName + "\"\r\nContent-Type: application/octet-stream\r\n\r\n"),
    fileBuffer,
    Buffer.from("\r\n--" + boundary + "--\r\n")
  ]);
  return { body, contentType: "multipart/form-data; boundary=" + boundary };
}

function findApiWithCustom(api) {
  let current = api;
  while (current && !Object.prototype.hasOwnProperty.call(current, "custom")) {
    current = Object.getPrototypeOf(current);
  }
  return current || api;
}

function registerStickerApi(api) {
  const target = findApiWithCustom(api);
  if (!target || typeof target.custom !== "function") {
    throw new Error("Zalo API không hỗ trợ custom endpoints cần cho sticker.");
  }
  if (target.__jtDiscordStickerApi) return target;
  Object.defineProperty(target, "__jtDiscordStickerApi", { value: true, configurable: true });

  target.custom("fetchZaloMedia", async ({ utils, props }) => {
    const url = normalizeSourceUrl(props?.url);
    if (!url || !isZaloMediaUrl(url)) throw new Error("Chỉ được tải media từ CDN Zalo hợp lệ.");
    const response = await utils.request(url, { timeoutMs: 18000, retries: 0 });
    if (!response?.ok) throw new Error("Tải media lỗi HTTP " + (response?.status ?? "?"));
    const contentLength = Number(response.headers?.get?.("content-length") || 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new Error("Media vượt giới hạn 20 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 64) throw new Error("Media Zalo rỗng hoặc quá nhỏ.");
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error("Media vượt giới hạn 20 MB.");
    return { buffer, contentType: response.headers?.get?.("content-type") || "" };
  });

  target.custom("uploadStickerImage", async ({ ctx, utils, props }) => {
    const { filePath, threadId, threadType } = props || {};
    if (!filePath || !fs.existsSync(filePath)) throw new Error("Không tìm thấy file sticker cần upload.");
    if (!threadId) throw new Error("Thiếu threadId khi upload sticker.");
    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer.length || fileBuffer.length > MAX_STICKER_BYTES) {
      throw new Error("File sticker rỗng hoặc vượt giới hạn 512 KB.");
    }
    const fileName = path.basename(filePath);
    const isGroup = Number(threadType) === 1;
    const uploadPath = isGroup ? UPLOAD_GROUP_PATH : UPLOAD_USER_PATH;
    const params = {
      totalChunk: 1,
      fileName,
      clientId: now(),
      totalSize: fileBuffer.length,
      imei: ctx.imei,
      isE2EE: 0,
      jxl: 0,
      chunkId: 1,
      ...(isGroup ? { grid: String(threadId) } : { toid: String(threadId) })
    };
    const encryptedParams = utils.encodeAES(JSON.stringify(params));
    if (!encryptedParams) throw new Error("Không mã hóa được thông tin upload sticker.");
    const url = utils.makeURL(resolveUploadHost(ctx) + uploadPath, {
      type: isGroup ? 11 : 2,
      params: encryptedParams
    });
    const multipart = buildMultipart(fileName, fileBuffer);
    const response = await utils.request(url, {
      method: "POST",
      headers: { "content-type": multipart.contentType },
      body: multipart.body,
      timeoutMs: 20000,
      retries: 0
    });
    return (await utils.resolve(response)) || {};
  });

  target.custom("sendCustomStickerUrl", async ({ ctx, utils, props }) => {
    const {
      staticImgUrl, animationImgUrl, threadId, threadType, reply = null, ttl = 0
    } = props || {};
    if (!staticImgUrl || !threadId) throw new Error("Thiếu URL sticker hoặc threadId.");
    const width = Number(props?.width) || STICKER_SIZE;
    const height = Number(props?.height) || STICKER_SIZE;
    const isGroup = Number(threadType) === 1;
    const sendPath = isGroup ? SEND_GROUP_PATH : SEND_USER_PATH;
    const url = utils.makeURL(resolveUploadHost(ctx) + sendPath, { nretry: 0 });
    const clientId = now() * 6000;
    const params = {
      clientId,
      title: "",
      oriUrl: staticImgUrl,
      thumbUrl: staticImgUrl,
      hdUrl: staticImgUrl,
      width,
      height,
      properties: JSON.stringify({
        subType: 0,
        color: -1,
        size: -1,
        type: 3,
        is_original: 0,
        ext: JSON.stringify({ sSrcStr: "@NGH_STICKER", sSrcType: 0 })
      }),
      contentId: now(),
      thumb_width: width,
      thumb_height: height,
      webp: JSON.stringify({ width, height, url: animationImgUrl || staticImgUrl }),
      msgBubbleLayoutType: 3,
      is_group_layout: 0,
      zsource: -1,
      jcp: JSON.stringify({ pStickerType: 1 }),
      ttl: Number(ttl) || 0,
      ...(isGroup ? { grid: String(threadId), visibility: 0 } : { toId: String(threadId) })
    };
    if (reply) params.refMessage = String(reply);
    const encryptedParams = utils.encodeAES(JSON.stringify(params));
    if (!encryptedParams) throw new Error("Không mã hóa được dữ liệu gửi sticker.");
    const response = await utils.request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "params=" + encodeURIComponent(encryptedParams),
      timeoutMs: 20000,
      retries: 0
    });
    const result = await utils.resolve(response);
    if (result && typeof result === "object" && !result.cliMsgId) {
      result.cliMsgId = String(clientId);
    }
    return result;
  });

  return target;
}

async function processSticker({ api, event, url, decorationId }) {
  if (!api || !event?.threadId) throw new Error("Thiếu thông tin cuộc trò chuyện để gửi sticker.");
  const normalizedUrl = normalizeSourceUrl(url);
  if (!normalizedUrl) throw new Error("Link media không hợp lệ. Chỉ nhận URL HTTP/HTTPS.");
  if (!decorationId) throw new Error("Bạn cần chọn một decoration Discord. Dùng /stk list hoặc /stk random.");

  registerStickerApi(api);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const source = await fetchSource(api, cleanMediaUrl(normalizedUrl));
  const ext = sourceExtension(normalizedUrl, source.contentType, source.buffer);
  if (ext === ".bin") throw new Error("Không nhận diện được định dạng ảnh/video. Hãy gửi PNG, JPG, GIF, WebP, MP4 hoặc MOV.");

  const decoration = await decorations.getDecoration(decorationId);
  if (!decoration) throw new Error("Không tìm thấy decoration Discord: " + String(decorationId).slice(0, 80) + ". Dùng /stk list hoặc /stk find <tên>.");
  const sourceIsAnimated = /\.(gif|webp|mp4|webm|mov|m4v)$/i.test(ext);
  const sourcePath = path.join(CACHE_DIR, uniqueName("stk-source", ext));
  let resolvedOverlayPath = null;
  let outputPath = null;
  let overlayCached = false;
  try {
    fs.writeFileSync(sourcePath, source.buffer);
    const overlay = await downloadDecorationOverlay(decoration, {
      animated: sourceIsAnimated || !decoration.staticAvailable
    });
    resolvedOverlayPath = overlay.path;
    overlayCached = overlay.cached;

    const output = await convertMedia(
      sourcePath,
      resolvedOverlayPath,
      path.join(CACHE_DIR, uniqueName("stk-discord-", "")),
      { overlayAnimated: overlay.animated }
    );
    outputPath = output.path;

    const uploaded = await api.uploadStickerImage({
      filePath: outputPath,
      threadId: event.threadId,
      threadType: event.type
    });
    const root = uploaded && typeof uploaded === "object" ? uploaded : {};
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
    const cdnUrl = data.normalUrl || data.hdUrl || data.thumbUrl || data.url || data.oriUrl ||
      root.normalUrl || root.hdUrl || root.thumbUrl || root.url;
    if (!cdnUrl) throw new Error("Zalo không trả về URL CDN sau khi upload sticker.");

    const quote = event.data?.quote || event.data?.dQuote || event.quote;
    const sent = await api.sendCustomStickerUrl({
      staticImgUrl: buildStickerUrl(String(cdnUrl), output.format === "webp"),
      animationImgUrl: buildStickerUrl(String(cdnUrl), output.format === "webp"),
      threadId: event.threadId,
      threadType: event.type,
      reply: quote?.msgId || null,
      width: output.width,
      height: output.height
    });
    return {
      ...output,
      response: sent,
      decorationId: decoration.id,
      frameName: decoration.name,
      overlayUrl: overlay.url
    };
  } finally {
    for (const filePath of [sourcePath, overlayCached ? null : resolvedOverlayPath, outputPath]) {
      if (!filePath) continue;
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
  }
}

module.exports = {
  MAX_SOURCE_BYTES,
  MAX_STICKER_BYTES,
  normalizeSourceUrl,
  isZaloMediaUrl,
  cleanMediaUrl,
  pickMediaUrl,
  sourceExtension,
  resolveFfmpegBinary,
  resolveUploadHost,
  buildStickerUrl,
  buildMultipart,
  registerStickerApi,
  isAllowedDecorationAssetUrl,
  downloadDecorationOverlay,
  convertMedia,
  tryRustStaticCircleSticker,
  // Shared low-level media helpers for the replacement /stk dis command.
  fetchSource,
  hasWebpEncoder,
  processSticker
};
