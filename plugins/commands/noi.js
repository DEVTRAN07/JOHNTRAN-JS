const fs = require("fs");
const path = require("path");
const tts = require("../../core/ai/tts");
const { processAudio } = require("../../utils/index");
const metrics = require("../../core/metrics");

const TTS_OFF_MESSAGE = "Tính năng đọc giọng nói đang tắt. Admin bật trong config.yml → ai.tts_enabled: true.";

module.exports.config = {
  name: "noi",
  aliases: ["tts", "doc"],
  version: "2.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Bot đọc văn bản thành giọng nói",
  category: "AI",
  usage: "noi <văn bản>",
  cooldowns: 5,
  dependencies: {}
};

module.exports.run = async ({ args, event, api, reply }) => {
  const { threadId, type, data } = event;

  if (!global.config?.ai?.tts_enabled) {
    return reply.error(TTS_OFF_MESSAGE);
  }

  const source = args.join(" ") || (typeof data?.quote?.content === "string" ? data.quote.content : "");
  if (!source.trim()) {
    return reply.card({
      theme: "ai",
      title: "Đọc giọng nói",
      subtitle: "Bot sẽ đọc văn bản bạn gửi",
      rows: [{ icon: "robot", label: "Cách dùng", lines: [global.config.prefix + "noi <văn bản> — tối đa 900 ký tự", global.config.prefix + "noi (reply tin nhắn) — đọc tin được reply"] }],
      footer: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ • AI"
    });
  }

  await reply.working();
  const tempDir = path.join(__dirname, "temp");
  const filePath = path.join(tempDir, "tts_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".mp3");

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    const buffer = await tts.textToSpeech(source);
    fs.writeFileSync(filePath, buffer);
    const voiceUrl = await processAudio(filePath, threadId, type);
    metrics.track("ttsRequest", { command: "noi" });
    await reply.voice({ voiceUrl });
    await reply.done();
  } catch (error) {
    await reply.failed();
    if (error.privacyBlocked) {
      return reply.error("Bot bị chặn gọi dịch vụ đọc giọng nói bởi chính sách bảo mật.");
    }
    return reply.error("Lỗi đọc giọng nói: " + error.message);
  } finally {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* bỏ qua */ }
    }
  }
};
