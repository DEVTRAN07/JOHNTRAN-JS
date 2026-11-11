// /getvoice — Trích xuất audio từ video (reply) rồi gửi voice lên Zalo
//   reply video → tải → ffmpeg trích MP3 → chuyển AAC → cache → gửi voice
const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseQuote, hint } = require("../../core/mediaReply");
const { runInWorker } = require("../../core/workerPool");
const { mediaCache } = require("../../core/mediaCache");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");

module.exports.config = {
  name: "getvoice",
  aliases: ["gvo", "voice"],
  version: "4.1.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Trích xuất audio từ video reply và gửi voice",
  category: "Tiện ích",
  usage: "getvoice (reply video)",
  cooldowns: 10,
  dependencies: {}
};

function convertMp3ToAac(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .audioCodec("aac")
      .on("end", () => {
        resolve(outputPath);
      })
      .on("error", (err) => {
        reject(err);
      })
      .run();
  });
}

module.exports.run = async function ({ api, event }) {
  const { threadId, type } = event;

  // Chấp nhận cả sticker động/GIF (cũng là "video")
  const media = parseQuote(event);
  if (!media) return api.sendMessage({ plain: true, msg: "❌ Hãy reply tin video cần trích audio." }, threadId, type);

  const videoUrl = media.video || media.file;
  if (!videoUrl) return api.sendMessage({ plain: true, msg: hint("video") }, threadId, type);

  const cacheMetadata = { sourceUrl: videoUrl };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_gvo_"));
  const videoPath = path.join(tmpDir, "in.mp4");

  try {
    await api.sendMessage({ msg: "⏳ Đang trích audio...", plain: true }, threadId, type);

    // 1) Tải video về
    const http = require("../../core/http");
    const { buffer: videoBuffer } = await http.getBuffer(videoUrl, { timeout: 120000 });
    fs.writeFileSync(videoPath, videoBuffer);

    // 2) Kiểm tra có tiếng không (ffmpeg -i in stream ra stderr)
    const { execFile } = require("child_process");
    const ffmpegBin = require("ffmpeg-static");
    const info = await new Promise((resolve) => {
      execFile(ffmpegBin, ["-i", videoPath], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve((stderr || "") + "\n" + (stdout || ""));
      });
    });
    if (!/Stream #\d+:\d+[^\n]*Audio:|#\d+:\d+.*Audio:/.test(info)) {
      return api.sendMessage({ plain: true, msg: "❌ Video này không có tiếng nên không trích được audio." }, threadId, type);
    }

    // 3) Trích MP3 bằng worker pool (ffmpeg libmp3lame 128k)
    const { audioBuffer } = await runInWorker("audioWorker", { videoPath }, { timeout: 180000 });
    if (!audioBuffer || !audioBuffer.length) throw new Error("Không trích được audio (buffer rỗng)");

    // 4) Ghi buffer ra file tạm để chuyển sang AAC
    const mp3Path = path.join(tmpDir, "out.mp3");
    fs.writeFileSync(mp3Path, audioBuffer);

    // 5) Chuyển MP3 sang AAC (chuẩn voice Zalo)
    const aacPath = path.join(tmpDir, "out.aac");
    await convertMp3ToAac(mp3Path, aacPath);

    // 6) Đọc AAC buffer và upload lên mediaCache (tự deduplicate bằng key = hash(buffer + metadata))
    const aacBuffer = fs.readFileSync(aacPath);
    const { url: voiceUrl } = await mediaCache.upload(aacBuffer, "audio", cacheMetadata);

    // 7) Gửi voice
    await api.sendVoice({ voiceUrl }, threadId, type);
  } catch (error) {
    console.error("getvoice:", error.message);
    return api.sendMessage({ plain: true, msg: "❌ Trích audio thất bại: " + error.message }, threadId, type);
  } finally {
    for (const f of [videoPath]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* bỏ qua */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
};
