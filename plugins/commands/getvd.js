// /getvd — Reply video → download → upload asyncfile (original) → gửi video GỐC
//   Không nén/không xử lý lại — gửi đúng file video người ta gửi.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseQuote, hint } = require("../../core/mediaReply");
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");

module.exports.config = {
  name: "getvd",
  aliases: ["vd", "getvideo"],
  version: "4.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Reply video rồi gửi lại video gốc (không nén)",
  category: "Tiện ích",
  usage: "getvd (reply video)",
  cooldowns: 10,
  dependencies: {}
};

// Đoán đuôi file từ URL để Zalo nhận diện đúng loại media
function extFromUrl(url, fallback = "mp4") {
  const m = String(url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : fallback;
}

module.exports.run = async function ({ api, event }) {
  const { threadId, type } = event;

  const media = parseQuote(event);
  if (!media) return api.sendMessage({ plain: true, msg: "❌ Hãy reply tin video cần gửi lại." }, threadId, type);

  const videoUrl = media.video || media.file;
  if (!videoUrl) return api.sendMessage({ plain: true, msg: hint("video") }, threadId, type);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_gvd_"));
  const ext = extFromUrl(videoUrl);
  const filePath = path.join(tmpDir, `video_${Date.now()}.${ext}`);

  try {
    await api.sendMessage({ msg: "⏳ Đang tải video gốc...", plain: true }, threadId, type);

    const http = require("../../core/http");
    const { buffer } = await queuedGetBuffer(videoUrl, { timeout: 180000, retries: 1 });
    fs.writeFileSync(filePath, buffer);

    const sizeMb = fs.statSync(filePath).size / 1048576;
    if (sizeMb > 100) {
      return api.sendMessage({ plain: true, msg: `❌ Video quá lớn (${sizeMb.toFixed(1)}MB > 100MB) nên Zalo không nhận.` }, threadId, type);
    }

    // Gửi file GỐC qua attachment (Zalo tự upload asyncfile)
    await api.sendMessage({
      msg: `🎬 GETVD — ${sizeMb.toFixed(1)}MB • ${ext.toUpperCase()}`,
      attachments: [filePath]
    }, threadId, type);
  } catch (error) {
    console.error("getvd:", error.message);
    return api.sendMessage({ plain: true, msg: `❌ Tải video thất bại: ${error.message}` }, threadId, type);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
};
