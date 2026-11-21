"use strict";

const fs = require("node:fs");
const path = require("node:path");
const updateReport = require("../../core/runtime/updateReport");

const ROOT = path.resolve(__dirname, "../..");

module.exports.config = {
  name: "update",
  aliases: ["up", "capnhat"],
  version: "1.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Lấy mã nguồn mới nhất từ GitHub main và tự khởi động lại bot",
  category: "Hệ thống",
  usage: "update",
  cooldowns: 30,
  requiresUserData: false,
  dependencies: {}
};

let requested = false;

function isSupportedUpdateRuntime(env = process.env, ipcSend = process.send) {
  const managed = env.JT_UPDATE_SUPERVISOR === "1" || env.JT_PANEL_CHILD === "1";
  return managed && typeof ipcSend === "function";
}

module.exports.run = async ({ event, api, reply }) => {
  const { threadId, type } = event || {};
  if (requested) return reply.error("Đang có một yêu cầu cập nhật được xử lý.");

  if (!isSupportedUpdateRuntime()) {
    return reply.error(
      "Không tìm thấy tiến trình giám sát để cập nhật an toàn. " +
      "Hãy khởi động bằng npm start (hoặc dùng bot do Panel quản lý); không chạy trực tiếp JohnTran.js.");
  }

  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    return reply.error(
      "Thư mục bot chưa phải Git clone. Cần clone JOHNTRAN-JS một lần trước khi dùng /update.");
  }

  requested = true;
  try {
    await api.sendMessage(
      "🔄 Đã nhận yêu cầu cập nhật JOHNTRAN-JS từ GitHub main. Bot sẽ dừng an toàn, lấy code mới và tự khởi động lại. Dữ liệu đăng nhập và thư mục data được giữ nguyên.",
      threadId,
      type
    );
  } catch (error) {
    requested = false;
    return reply.error("Không gửi được thông báo cập nhật: " + (error?.message || error));
  }

  let updateRequest;
  try {
    updateRequest = updateReport.writeUpdateRequest(ROOT, {
      botName: process.env.JT_BOT_NAME || "main",
      threadId,
      threadType: type
    });
  } catch (error) {
    requested = false;
    return reply.error("Không lưu được nơi nhận kết quả cập nhật: " + (error?.message || error));
  }

  return new Promise(resolve => {
    process.send({ type: "jt:update-request", botName: process.env.JT_BOT_NAME || "main" }, error => {
      if (error) {
        requested = false;
        updateReport.clearUpdateRequest(ROOT, updateRequest.id);
        api.sendMessage(
          "❌ Không thể gửi yêu cầu cập nhật tới tiến trình giám sát: " + (error.message || error),
          threadId,
          type
        ).catch(() => {});
        resolve(false);
        return;
      }
      resolve(true);
      setImmediate(() => process.exit(3));
    });
  });
};

module.exports._test = {
  isSupportedUpdateRuntime
};
