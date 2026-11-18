"use strict";

const fs = require("node:fs");
const { ThreadType } = require("zalo-client");
const { getGroupAdminState } = require("./groupAdmin");

const FEATURES = Object.freeze({
  antinude: {
    key: "anti_nude",
    label: "AI quét ảnh 18+; cảnh cáo 3 lần, tái phạm lần 4 kick",
    cardLabel: "Anti-Nude",
    detail: "AI kiểm tra ảnh nhạy cảm; cảnh cáo 3 lần, tái phạm lần 4 sẽ kick.",
    usage: "antinude [on/off]"
  },
  antirecall: {
    key: "anti_undo",
    label: "chống thu hồi tin nhắn",
    cardLabel: "Anti-Recall",
    detail: "Lưu và khôi phục nội dung khi thành viên thu hồi tin nhắn.",
    usage: "antirecall [on/off]"
  },
  antilink: {
    key: "anti_danger_link",
    label: "chặn link mời nhóm khác / link nguy hiểm",
    cardLabel: "Anti-Link",
    detail: "Chặn link mời nhóm Zalo khác và URL không an toàn.",
    usage: "antilink [on/off]"
  },
  antispam: {
    key: "anti_sticker_spam",
    label: "chống dội bom spam sticker",
    cardLabel: "Anti-Spam Sticker",
    detail: "Phát hiện và xử lý thành viên gửi sticker dồn dập.",
    usage: "antispam [on/off]"
  }
});

async function sendAntiToggleNotice(api, threadId, type, options = {}) {
  const label = String(options.label || "Anti");
  const enabled = options.enabled === true;
  const detail = String(options.detail || "Thiết lập đã được lưu thành công cho nhóm.");
  const action = enabled ? "bật" : "tắt";
  const notice = "✓ Đã " + action + " thành công chế độ " + label + " cho nhóm!";
  const card = {
    brand: "JOHNTRAN",
    chip: enabled ? "ANTI / ENABLED" : "ANTI / DISABLED",
    theme: "success",
    title: "THÔNG BÁO HỆ THỐNG",
    subtitle: notice,
    sections: [{
      title: "CẬP NHẬT BẢO VỆ NHÓM",
      lines: [
        label,
        "Trạng thái: " + (enabled ? "ĐANG BẬT" : "ĐANG TẮT"),
        detail
      ]
    }],
    footer: "JOHNTRAN  •  GROUP SECURITY"
  };
  const fallback = () => api.sendMessage({
    msg: "ℹ️ THÔNG BÁO HỆ THỐNG\n" + notice
  }, threadId, type);

  let imagePath = null;
  try {
    const { renderCanvas } = require("../canvas/workerRender");
    imagePath = await renderCanvas("card", card);
  } catch (error) {
    console.error("[ANTI_NOTICE] Không render được Canvas:", error?.message || error);
    return fallback();
  }

  try {
    return await api.sendMessage({
      msg: "ℹ️ THÔNG BÁO HỆ THỐNG",
      attachments: [imagePath],
      ttlKind: "card"
    }, threadId, type);
  } catch (error) {
    console.error("[ANTI_NOTICE] Không gửi được Canvas, chuyển sang thông báo chữ:", error?.message || error);
    return fallback();
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        fs.unlink(imagePath, () => {});
      }, 60_000);
      timer.unref?.();
    }
  }
}

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

  const enabled = mode === "on";
  data[spec.key] = enabled;
  const save = context.Threads.setDataAndWait || context.Threads.setData;
  await save.call(context.Threads, threadId, data);

  return sendAntiToggleNotice(api, threadId, type, {
    label: spec.cardLabel,
    enabled,
    detail: spec.detail
  });
}

module.exports = { FEATURES, runAntiToggle, sendAntiToggleNotice };
