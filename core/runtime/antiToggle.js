"use strict";

const { ThreadType } = require("zalo-client");
const { getGroupAdminState } = require("./groupAdmin");

const FEATURES = Object.freeze({
  antinude: { key: "anti_nude", label: "AI quét ảnh 18+ / khỏa thân", usage: "antinude [on/off]" },
  antirecall: { key: "anti_undo", label: "chống thu hồi tin nhắn", usage: "antirecall [on/off]" },
  antilink: { key: "anti_danger_link", label: "chặn link mời nhóm khác / link nguy hiểm", usage: "antilink [on/off]" },
  antispam: { key: "anti_sticker_spam", label: "chống dội bom spam sticker", usage: "antispam [on/off]" }
});

async function runAntiToggle(featureName, context = {}) {
  const spec = FEATURES[featureName];
  if (!spec) throw new Error("Anti feature không hợp lệ");

  const api = context.api;
  const event = context.event || {};
  const threadId = String(event.threadId || "");
  const type = event.type;
  const prefix = global.config?.prefix || "/";
  const send = (msg) => api.sendMessage({ msg }, threadId, type);

  if (!threadId || type !== ThreadType.Group) {
    return send("⚠️ Lệnh này chỉ sử dụng được trong nhóm Zalo.");
  }

  const userId = event.data?.uidFrom;
  const groupAdminState = await getGroupAdminState(api, threadId, userId);
  if (groupAdminState !== true) {
    return send("🚫 Chỉ trưởng nhóm hoặc phó nhóm (QTV BOX) mới được bật/tắt chế độ này.");
  }

  const mode = String(context.args?.[0] || "").trim().toLowerCase();
  const record = await context.Threads.getData(threadId);
  const data = { ...(record?.data || {}) };

  if (!mode) {
    return send(
      "👑 QTV BOX — " + spec.label + "\n" +
      "Trạng thái: " + (data[spec.key] === true ? "ĐANG BẬT ✅" : "ĐANG TẮT ⛔") + "\n" +
      "Cách dùng: " + prefix + spec.usage
    );
  }

  if (mode !== "on" && mode !== "off") {
    return send("⚠️ Cách dùng: " + prefix + spec.usage);
  }

  if (featureName === "antinude" && mode === "on" &&
      !(process.env.OPENAI_API_KEY || process.env.JT_ANTINUDE_OPENAI_API_KEY)) {
    return send(
      "⚠️ Chưa cấu hình OPENAI_API_KEY nên chưa thể bật AI quét ảnh.\n" +
      "Hãy thêm OPENAI_API_KEY vào Environment Variables rồi khởi động lại bot."
    );
  }

  data[spec.key] = mode === "on";
  const save = context.Threads.setDataAndWait || context.Threads.setData;
  await save.call(context.Threads, threadId, data);
  return send("✅ QTV BOX đã " + (mode === "on" ? "BẬT" : "TẮT") + " " + spec.label + ".");
}

module.exports = { FEATURES, runAntiToggle };
