"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const catalog = require("../core/data/stkDiscord200.json");
const { RAW_BASE_URL, ASSETS_DIR, MAX_FRAME_SIDE } = require("../core/stk/assets");

const MAX_FRAME_BYTES = 10 * 1024 * 1024;
const MAX_MENU_BYTES = 8 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const RETRIES = 3;

function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function isJpeg(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function pngDimensions(buffer) {
  if (!isPng(buffer)) return { width: 0, height: 0 };
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readUsableFile(filePath, validator, maxBytes) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
    const buffer = await fsp.readFile(filePath);
    return validator(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

async function fetchBuffer(fileName, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_FRAME_BYTES;
  const url = RAW_BASE_URL + "/" + encodeURIComponent(fileName);
  if (typeof fetchImpl !== "function") throw new Error("Node.js không hỗ trợ fetch.");

  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "JOHNTRAN-JS-STK-Asset-Bootstrap" }
      });
      if (!response || !response.ok) {
        throw new Error("HTTP " + Number(response && response.status || 0));
      }
      const contentLength = Number(response.headers?.get?.("content-length") || 0);
      if (contentLength > maxBytes) throw new Error("Tệp vượt giới hạn " + maxBytes + " byte.");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > maxBytes) {
        throw new Error("Tệp rỗng hoặc vượt giới hạn kích thước.");
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Không tải được " + fileName + ": " +
    String(lastError?.message || lastError || "lỗi mạng"));
}

async function optimizeStaticPng(buffer) {
  if (!isPng(buffer)) throw new Error("Nguồn không phải PNG hợp lệ.");
  // APNG files must remain byte-for-byte intact to preserve their animation.
  if (buffer.includes(Buffer.from("acTL"))) return buffer;

  const dimensions = pngDimensions(buffer);
  const longestSide = Math.max(dimensions.width, dimensions.height);
  if (!longestSide || longestSide <= MAX_FRAME_SIDE) return buffer;

  const scale = MAX_FRAME_SIDE / longestSide;
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  const { createCanvas, loadImage } = require("canvas");
  const image = await loadImage(buffer);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  const optimized = canvas.toBuffer("image/png", { compressionLevel: 9 });
  if (!isPng(optimized)) throw new Error("Không thể tối ưu PNG khung.");
  return optimized;
}

async function atomicWrite(filePath, buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid + "-" +
    crypto.randomBytes(5).toString("hex");
  try {
    await fsp.writeFile(tempPath, buffer, { flag: "wx" });
    await fsp.rename(tempPath, filePath);
  } finally {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(items.length || 1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function downloadAllAssets(options = {}) {
  const directory = path.resolve(options.directory || ASSETS_DIR);
  const items = Array.isArray(options.items) ? options.items : catalog.items;
  const includeMenu = options.includeMenu !== false;
  const force = options.force === true;
  const concurrency = Number.isFinite(options.concurrency)
    ? options.concurrency : DEFAULT_CONCURRENCY;
  const logger = options.logger || console;
  await fsp.mkdir(directory, { recursive: true });

  const startedAt = Date.now();
  let downloaded = 0;
  let skipped = 0;
  let totalBytes = 0;

  const manifestItems = await runWithConcurrency(items, concurrency, async item => {
    const fileName = String(item.file || "");
    try {
      if (!fileName || path.basename(fileName) !== fileName || !/\.png$/i.test(fileName)) {
        throw new Error("Tên khung không hợp lệ.");
      }
      const targetPath = path.join(directory, fileName);
      let buffer = !force
        ? await readUsableFile(targetPath, isPng, MAX_FRAME_BYTES)
        : null;
      let wasDownloaded = false;
      if (!buffer) {
        const source = await fetchBuffer(fileName, {
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          maxBytes: MAX_FRAME_BYTES
        });
        if (!isPng(source)) throw new Error("Nguồn không phải PNG hợp lệ.");
        buffer = await optimizeStaticPng(source);
        await atomicWrite(targetPath, buffer);
        wasDownloaded = true;
      }

      const dimensions = pngDimensions(buffer);
      totalBytes += buffer.length;
      if (wasDownloaded) downloaded += 1;
      else skipped += 1;
      return {
        id: item.id,
        file: fileName,
        width: dimensions.width,
        height: dimensions.height,
        bytes: buffer.length,
        sha256: sha256(buffer),
        optimized: dimensions.width <= MAX_FRAME_SIDE && dimensions.height <= MAX_FRAME_SIDE,
        downloaded: wasDownloaded,
        missing: false
      };
    } catch (error) {
      logger.warn?.("[stk-assets] Khung #" + item.id + " chưa tải được: " +
        String(error?.message || error));
      return {
        id: item.id,
        file: fileName,
        missing: true,
        error: String(error?.message || error).slice(0, 240)
      };
    }
  });

  let menu = null;
  let menuMissing = false;
  if (includeMenu) {
    try {
      const menuPath = path.join(directory, "menu.jpg");
      let buffer = !force
        ? await readUsableFile(menuPath, isJpeg, MAX_MENU_BYTES)
        : null;
      const wasDownloaded = !buffer;
      if (!buffer) {
        buffer = await fetchBuffer("menu.jpg", {
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          maxBytes: MAX_MENU_BYTES
        });
        if (!isJpeg(buffer)) throw new Error("menu.jpg tải về không phải JPEG hợp lệ.");
        await atomicWrite(menuPath, buffer);
      }
      totalBytes += buffer.length;
      menu = { file: "menu.jpg", bytes: buffer.length, sha256: sha256(buffer), downloaded: wasDownloaded };
    } catch (error) {
      menuMissing = true;
      logger.warn?.("[stk-assets] Menu chưa tải được: " + String(error?.message || error));
      menu = { file: "menu.jpg", missing: true, error: String(error?.message || error).slice(0, 240) };
    }
  }

  const manifest = {
    version: 1,
    source: "DEVTRAN07/Discord-decor",
    sourceCommit: require("../core/stk/assets").SOURCE_COMMIT,
    downloadedAt: new Date().toISOString(),
    total: manifestItems.length,
    menu,
    items: manifestItems.map(({ downloaded: _downloaded, ...item }) => item)
  };
  await atomicWrite(
    path.join(directory, "assets-manifest.json"),
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
  );

  const result = {
    directory,
    total: manifestItems.length,
    available: manifestItems.filter(item => !item.missing).length,
    downloaded,
    skipped,
    totalBytes,
    elapsedMs: Date.now() - startedAt,
    missing: manifestItems.filter(item => item.missing).length,
    menuMissing
  };
  logger.info?.(
    "[stk-assets] " + result.available + "/" + result.total +
    " frames local; downloaded=" + downloaded +
    ", reused=" + skipped +
    ", size=" + (totalBytes / 1048576).toFixed(1) + "MB" +
    ", time=" + result.elapsedMs + "ms"
  );
  return result;
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  downloadAllAssets({ force }).then(result => {
    if (result.missing > 0 || result.menuMissing) {
      console.error("[stk-assets] Thiếu " + result.missing + " khung; menuMissing=" + result.menuMissing);
      process.exitCode = 1;
    }
  }).catch(error => {
    console.error("[stk-assets] Download failed:", error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  isPng,
  isJpeg,
  pngDimensions,
  fetchBuffer,
  optimizeStaticPng,
  runWithConcurrency,
  downloadAllAssets
};
