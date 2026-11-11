const { parentPort } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { probeVideo } = require("../videoMeta");

ffmpeg.setFfmpegPath(require("ffmpeg-static"));

const IDLE_EXIT_MS = 20000;

function convertDurationToFiveDigits(durationStr) {
  const duration = parseFloat(durationStr);
  const [sec, millisRaw] = duration.toFixed(3).split(".");
  return `${parseInt(sec)}${millisRaw}`;
}

async function extractThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .on("end", () => {
        resolve(thumbnailPath);
      })
      .on("error", (err) => {
        reject(err);
      })
      .screenshots({
        count: 1,
        folder: path.dirname(thumbnailPath),
        filename: path.basename(thumbnailPath),
        timemarks: ["0"]
      });
  });
}

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

    const videoInfo = await probeVideo(videoPath);

    const metadata = {
      duration: convertDurationToFiveDigits(videoInfo.format.duration),
      width: videoInfo.width,
      height: videoInfo.height,
    };

    const folderPath = path.dirname(videoPath);
    const thumbnailPath = path.join(folderPath, `thumb_${Date.now()}.jpg`);

    await extractThumbnail(videoPath, thumbnailPath);

    const thumbnailBuffer = fs.readFileSync(thumbnailPath);
    try { fs.unlinkSync(thumbnailPath); } catch {}

    parentPort.postMessage({
      ok: true,
      data: {
        metadata,
        thumbnailBuffer
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
