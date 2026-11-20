"use strict";

const fs = require("node:fs");
const { ThreadType } = require("zalo-client");
const { getGroupAdminState } = require("../../../core/runtime/groupAdmin");
const { getBotGroupRole } = require("../../../core/runtime/botGroupKey");

const FEATURES = Object.freeze({
  anticard: { key:"anti_card", label:"chặn gửi danh thiếp", cardLabel:"Anti-Card", detail:"Chặn nội dung danh thiếp / chia sẻ hồ sơ.", usage:"anticard [on/off]" },
  antidoodle: { key:"anti_doodle", label:"chặn gửi nét vẽ doodle", cardLabel:"Anti-Doodle", detail:"Chặn payload doodle / bản vẽ được Zalo nhận diện.", usage:"antidoodle [on/off]" },
  antifile: { key:"anti_file", label:"chặn gửi tập tin", cardLabel:"Anti-File", detail:"Chặn tệp đính kèm dạng share.file.", usage:"antifile [on/off]" },
  antigif: { key:"anti_gif", label:"chặn gửi ảnh động GIF", cardLabel:"Anti-GIF", detail:"Chặn GIF có msgType hoặc MIME được nhận diện là GIF.", usage:"antigif [on/off]" },
  antiinvite: { key:"anti_danger_link", label:"chặn link mời nhóm khác", cardLabel:"Anti-Invite", detail:"Chặn link mời nhóm Zalo khác và URL không an toàn.", usage:"antiinvite [on/off]" },
  antijoin: { key:"anti_join", label:"chặn spam vào lại nhóm", cardLabel:"Anti-Join", detail:"Lần vào đầu tiên để lập mốc; 3 lần tái tham gia trong 10 phút bị cảnh cáo, lần tiếp theo sẽ kick.", usage:"antijoin [on/off]" },
  antilink: { key:"anti_link", label:"chặn liên kết mạng", cardLabel:"Anti-Link", detail:"Chặn mọi URL được gửi trong nhóm.", usage:"antilink [on/off]" },
  antilocation: { key:"anti_location", label:"chặn chia sẻ vị trí", cardLabel:"Anti-Location", detail:"Chặn tin nhắn vị trí/bản đồ khi payload Zalo có kiểu location hoặc tọa độ.", usage:"antilocation [on/off]" },
  antiother: { key:"anti_other", label:"chặn payload lỗi / không xác định", cardLabel:"Anti-Other", detail:"Chặn riêng payload Zalo được đánh dấu unknown, unsupported hoặc error; không chặn tin nhắn bình thường.", usage:"antiother [on/off]" },
  antiphoto: { key:"anti_photo", label:"chặn gửi hình ảnh", cardLabel:"Anti-Photo", detail:"Chặn ảnh chat.photo / chat.image.", usage:"antiphoto [on/off]" },
  antiqr: { key:"anti_qr", label:"chặn mã QR được nhận diện", cardLabel:"Anti-QR", detail:"Quét payload QR và giải mã QR trực tiếp từ ảnh thường; ảnh không chứa QR sẽ không bị chặn.", usage:"antiqr [on/off]" },
  antireaction: { key:"anti_reaction", label:"chống spam cảm xúc", cardLabel:"Anti-Reaction", detail:"Phát hiện hơn 5 reaction trong 10 giây; 3 lần cảnh cáo, tái phạm lần 4 sẽ kick. Zalo không hỗ trợ gỡ reaction của thành viên khác.", usage:"antireaction [on/off]" },
  antisex: { key:"anti_nude", label:"AI chặn nội dung nhạy cảm 18+", cardLabel:"Anti-Sex", detail:"AI kiểm tra ảnh; cảnh cáo 3 lần, tái phạm lần 4 sẽ kick.", usage:"antisex [on/off]" },
  antinude: { key:"anti_nude", label:"AI chặn nội dung nhạy cảm 18+", cardLabel:"Anti-Nude", detail:"AI kiểm tra ảnh; cảnh cáo 3 lần, tái phạm lần 4 sẽ kick.", usage:"antinude [on/off]" },
  antispam: { key:"anti_spam", label:"chặn spam tin nhắn", cardLabel:"Anti-Spam", detail:"Phát hiện hơn 5 tin nhắn văn bản trong 5 giây; không tính ảnh, video, sticker hoặc voice.", usage:"antispam [on/off]" },
  antistk: { key:"anti_sticker", label:"chặn mọi sticker", cardLabel:"Anti-Sticker", detail:"Không cho gửi sticker trong nhóm.", usage:"antistk [on/off]" },
  antistklag: { key:"anti_sticker_spam", label:"chặn spam sticker gây lag", cardLabel:"Anti-Sticker-Lag", detail:"Phát hiện hơn 5 sticker trong 4 giây và xóa loạt sticker.", usage:"antistklag [on/off]" },
  antitaghide: { key:"anti_taghide", label:"chặn nhắc tên ẩn", cardLabel:"Anti-Tag-Hide", detail:"Chặn mention được payload đánh dấu hidden hoặc có vị trí/độ dài không hợp lệ.", usage:"antitaghide [on/off]" },
  antivideo: { key:"anti_video", label:"chặn gửi video", cardLabel:"Anti-Video", detail:"Chặn tin nhắn chat.video.msg.", usage:"antivideo [on/off]" },
  antivoice: { key:"anti_voice", label:"chặn tin nhắn thoại", cardLabel:"Anti-Voice", detail:"Chặn tin nhắn chat.voice.", usage:"antivoice [on/off]" },
  antiword: { key:"anti_word", label:"chặn từ ngữ thô tục / từ cấm", cardLabel:"Anti-Word", detail:"So khớp danh sách từ cấm tiếng Việt và assets/spam/badwords.txt.", usage:"antiword [on/off]" },
  antirecall: { key:"anti_undo", label:"chống thu hồi tin nhắn", cardLabel:"Anti-Recall", detail:"Lưu và khôi phục nội dung khi thành viên thu hồi tin nhắn.", usage:"antirecall [on/off]" }
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
      lines: [label, "Trạng thái: " + (enabled ? "ĐANG BẬT" : "ĐANG TẮT"), detail]
    }],
    footer: "JOHNTRAN  •  GROUP SECURITY"
  };
  const fallback = () => api.sendMessage({
    msg: "ℹ️ THÔNG BÁO HỆ THỐNG\n" + notice
  }, threadId, type);

  let imagePath = null;
  try {
    const { renderCanvas } = require("../../../core/canvas/workerRender");
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
      const timer = setTimeout(() => fs.unlink(imagePath, () => {}), 60_000);
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
  const send = msg => api.sendMessage({ msg }, threadId, type);

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
  const keys = Array.isArray(spec.flags) && spec.flags.length ? spec.flags : [spec.key];
  const enabledBefore = keys.every(key => data[key] === true);

  if (!mode) {
    let runtimeWarning = "";
    if (enabledBefore) {
      const botRole = await getBotGroupRole(api, threadId);
      if (botRole !== "owner" && botRole !== "deputy") {
        runtimeWarning =
          "\n⚠️ Cấu hình vẫn đang BẬT nhưng tài khoản bot hiện không có QTV (role=" +
          botRole + "). Anti đang tạm ngừng xử lý; hãy cấp bot làm phó nhóm rồi kiểm tra lại.";
      }
    }
    return send(
      "👑 QTV BOX — " + spec.label + "\n" +
      "Trạng thái: " + (enabledBefore ? "ĐANG BẬT ✅" : "ĐANG TẮT ⛔") + "\n" +
      "Cách dùng: " + prefix + spec.usage +
      runtimeWarning
    );
  }

  if (mode !== "on" && mode !== "off") {
    return send("⚠️ Cách dùng: " + prefix + spec.usage);
  }

  // Anti handlers fail closed when the bot account is not a group owner/deputy.
  // Reject enabling at the control point instead of showing a misleading
  // success card for a protection mode that can never enforce its rules.
  if (mode === "on") {
    const botRole = await getBotGroupRole(api, threadId);
    if (botRole !== "owner" && botRole !== "deputy") {
      return send(
        "⛔ Không thể bật " + spec.cardLabel + ": tài khoản bot chưa có quyền QTV trong nhóm. " +
        "Hãy thêm bot làm phó nhóm (QTV), sau đó bật lại lệnh."
      );
    }
  }

  if ((featureName === "antinude" || featureName === "antisex") && mode === "on" &&
      !(process.env.OPENAI_API_KEY || process.env.JT_ANTINUDE_OPENAI_API_KEY)) {
    return send(
      "⚠️ Chưa cấu hình OPENAI_API_KEY nên chưa thể bật AI quét ảnh.\n" +
      "Hãy thêm OPENAI_API_KEY vào Environment Variables rồi khởi động lại bot."
    );
  }

  const enabled = mode === "on";
  for (const key of keys) data[key] = enabled;
  const save = context.Threads.setDataAndWait || context.Threads.setData;
  await save.call(context.Threads, threadId, data);

  return sendAntiToggleNotice(api, threadId, type, {
    label: spec.cardLabel,
    enabled,
    detail: spec.detail
  });
}

module.exports = { FEATURES, runAntiToggle, sendAntiToggleNotice };
