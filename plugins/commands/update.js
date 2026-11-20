"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

module.exports.run = async ({ event, api, reply }) => {
  const { threadId, type } = event || {};
  if (requested) return reply.error("Đang có một yêu cầu cập nhật được xử lý.");

  if (process.env.JT_UPDATE_SUPERVISOR !== "1" || typeof process.send !== "function") {
    return reply.error(
      "Tự cập nhật qua Zalo cần chạy bot bằng npm start (supervisor thường). " +
      "Panel bot hoặc chạy trực tiếp JohnTran.js chưa hỗ trợ lệnh này.");
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

  return new Promise(resolve => {
    process.send({ type: "jt:update-request" }, error => {
      if (error) {
        requested = false;
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
  isSupportedSupervisor: () => process.env.JT_UPDATE_SUPERVISOR === "1" && typeof process.send === "function"
};
