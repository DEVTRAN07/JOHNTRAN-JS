const { parentPort } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const converter = require("../stickerConvert");

const CACHE_DIR = path.join(__dirname, "..", "assets", "cache", "sticker");
const IDLE_EXIT_MS = 20000;

function mimeTypeFor(format) {
  return format === "gif" ? "image/gif" : "image/webp";
}

// Chuyển đổi sticker (ffmpeg, CPU-nặng) ở worker riêng.
// Nhận: { url, frameId, forceStatic, threadId, type, apiToken }
// Chỉ làm ffmpeg + trả về buffer; upload Zalo CDN cần api instance → chạy ở main thread.
let idleTimer = null;
function scheduleIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try { process.exit(0); } catch {}
  }, IDLE_EXIT_MS);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

parentPort.on("message", async (payload) => {
  const { url, frameId, forceStatic } = payload || {};
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    if (!url || typeof url !== "string") {
      throw new Error("Thiếu URL media");
    }

    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // fetchImpl = undefined → dùng core/http (không cần api/session của Zalo).
    const file = await converter.makeStickerFile(
      url,
      CACHE_DIR,
      forceStatic === true,
      undefined,
      { frameId: Number(frameId || 1) }
    );

    const buffer = fs.readFileSync(file.path);
    try { fs.unlinkSync(file.path); } catch { /* bỏ qua */ }

    parentPort.postMessage({
      ok: true,
      data: {
        buffer,
        mimeType: mimeTypeFor(file.format),
        width: file.width,
        height: file.height,
        format: file.format
      }
    });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: err.message || String(err),
      stack: err.stack
    });
  } finally {
    scheduleIdleExit();
  }
});
scheduleIdleExit();
