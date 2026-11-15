"use strict";

const { ThreadType } = require("zalo-client");

module.exports.config = {
  name: "bot",
  aliases: [],
  version: "1.0.0",
  role: 2,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Bật hoặc tắt bot riêng cho nhóm hiện tại",
  category: "Hệ thống",
  usage: "bot on|off|status",
  cooldowns: 1,
  dependencies: {}
};

module.exports.run = async function ({ event, args, Threads, reply }) {
  if (event?.type === ThreadType.User) {
    return reply.error("Lệnh này chỉ dùng trong nhóm.");
  }

  const threadId = String(event?.threadId || "");
  if (!threadId) return reply.error("Không xác định được nhóm hiện tại.");

  const action = String(args?.[0] || "status").trim().toLowerCase();
  if (!["on", "off", "status"].includes(action)) {
    return reply.error(`Dùng: ${global.config.prefix}bot on|off|status`);
  }

  const record = await Threads.getData(threadId);
  const data = record?.data || {};
  const currentlyEnabled = data.bot_enabled !== false;

  if (action === "status") {
    return reply.info(
      `Bot trong nhóm hiện đang ${currentlyEnabled ? "BẬT ✅" : "TẮT ⏸️"}.`,
      { title: "TRẠNG THÁI BOT NHÓM" }
    );
  }

  const enabled = action === "on";
  if (currentlyEnabled === enabled) {
    return reply.info(`Bot đã ${enabled ? "được bật" : "được tắt"} trong nhóm này.`);
  }

  data.bot_enabled = enabled;
  await Threads.setData(threadId, data);

  return reply.success(
    enabled
      ? "Đã bật bot trong nhóm này. Các lệnh và sự kiện đã hoạt động trở lại."
      : "Đã tắt bot trong nhóm này. Bot sẽ im lặng và bỏ qua lệnh, điều hướng, sự kiện tự động."
  );
};
