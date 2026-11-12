"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");

let vdgirl = [];
try {
  vdgirl = require("../../assets/vdgirl.json");
} catch {
  vdgirl = [];
}

module.exports.config = {
  name: "vdgirl",
  aliases: ["vdgai"],
  version: "1.0.6",
  role: 0,
  author: "ShinTHL09",
  description: "Xem video ngẫu nhiên",
  category: "Giải trí",
  usage: "vdgirl",
  cooldowns: 2
};

function isVideo(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512) return false;
  const type = String(contentType || "").toLowerCase();
  const hasMp4Signature = buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
  return type.startsWith("video/") || type.includes("octet-stream") || hasMp4Signature;
}

module.exports.run = async ({ event, api }) => {
  const { threadId, type } = event;
  if (!Array.isArray(vdgirl) || vdgirl.length === 0) {
    return api.sendMessage("❌ Chưa có nguồn video.", threadId, type);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_vdgirl_"));
  const filePath = path.join(tempDir, "gai.mp4");

  try {
    const start = Math.floor(Math.random() * vdgirl.length);
    const attempts = Math.min(5, vdgirl.length);
    let lastError = null;
    let downloaded = false;

    for (let i = 0; i < attempts; i++) {
      const link = vdgirl[(start + i) % vdgirl.length];
      try {
        const { buffer, contentType, status } = await queuedGetBuffer(link, {
          timeout: 90000,
          retries: 2,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            "Referer": "https://files.catbox.moe/",
            "Accept": "video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5"
          }
        });
        if (status >= 400) throw new Error("Nguồn video trả HTTP " + status);
        if (!isVideo(buffer, contentType)) {
          throw new Error("Nguồn không trả về video hợp lệ (" + (contentType || "không rõ định dạng") + ")");
        }
        fs.writeFileSync(filePath, buffer);
        downloaded = true;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.warn("[vdgirl] nguồn video lỗi, thử nguồn tiếp theo:", error?.message || error);
      }
    }

    if (!downloaded) {
      throw lastError || new Error("Không có nguồn video khả dụng.");
    }

    const sizeMb = fs.statSync(filePath).size / 1048576;
    if (sizeMb > 100) {
      throw new Error("Video quá lớn (" + sizeMb.toFixed(1) + "MB > 100MB), Zalo không nhận.");
    }

    // Gửi file MP4 cục bộ qua uploader attachment của Zalo.
    // Không dùng sendVideo(videoUrl) vì SDK phải fetch URL và lỗi với URL cache/local.
    await api.sendMessage({
      msg: "🎥 Video ngẫu nhiên",
      attachments: [filePath],
      ttlKind: "media"
    }, threadId, type);
  } catch (error) {
    console.error("[vdgirl] không thể gửi video:", error?.message || error);
    await api.sendMessage(
      "❌ Không thể tải/gửi video: " + String(error?.message || error).slice(0, 180),
      threadId,
      type
    );
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
};
