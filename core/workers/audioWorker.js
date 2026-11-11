const { parentPort } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const IDLE_EXIT_MS = 20000;

let idleTimer = null;
function scheduleIdleExit() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try { process.exit(0); } catch {}
  }, IDLE_EXIT_MS);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

parentPort.on("message", async (payload) => {
  const { videoPath } = payload || {};
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    if (!videoPath || typeof videoPath !== "string") {
      throw new Error("Thiếu videoPath");
    }
    if (!fs.existsSync(videoPath)) {
      throw new Error("File video không tồn tại: " + videoPath);
    }

    const mp3Path = path.join(path.dirname(videoPath), "audio_" + Date.now() + ".mp3");

    await new Promise((resolve, reject) => {
      execFile(
        ffmpegPath,
        ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-b:a", "128k", mp3Path],
        { maxBuffer: 64 * 1024 * 1024 },
        (error) => {
          if (error) {
            reject(new Error((error.message || "").split("\n").slice(-2).join(" ") || "ffmpeg lỗi"));
            return;
          }
          resolve();
        }
      );
    });

    if (!fs.existsSync(mp3Path)) {
      throw new Error("Không trích được audio (file ra rỗng)");
    }

    const audioBuffer = fs.readFileSync(mp3Path);
    try { fs.unlinkSync(mp3Path); } catch {}

    parentPort.postMessage({
      ok: true,
      data: { audioBuffer }
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