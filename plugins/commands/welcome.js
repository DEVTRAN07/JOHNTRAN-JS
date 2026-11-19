"use strict";
const fs = require("node:fs");
const { ThreadType } = require("zalo-client");
const welcomeCanvas = require("../../core/canvas/welcome");
module.exports.config = {
  name: "welcome", aliases: ["wel"], version: "1.0.1", role: 2, author: "JOHNTRAN",
  description: "Quản lý lời chào thành viên mới bằng Canvas", category: "Quản lý nhóm",
  usage: "welcome | welcome on|off | welcome test", cooldowns: 2, dependencies: { canvas: "" }
};
function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => { try { fs.rmSync(filePath, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}
function groupName(event) {
  return String(event?.data?.threadName || event?.data?.groupName || event?.threadName || "Nhóm hiện tại").trim();
}
function requester(event) {
  const data = event?.data || {};
  const name = String(data.dName || data.displayName || data.name || "Thành viên mới").trim();
  const raw = data.avatar || data.avatar_25 || data.avatarUrl || "";
  const avatarUrl = /^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : "";
  return { name, avatarUrl };
}
async function sendCard({ api, event, reply, spec }) {
  let cardPath = null;
  try {
    cardPath = await welcomeCanvas.renderWelcomeCard(spec);
    return await api.sendMessage({ msg: "", attachments: [cardPath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    const message = "Không thể tạo Canvas welcome: " + (error?.message || "Lỗi không xác định");
    console.error("[WELCOME_COMMAND]", error?.stack || error);
    if (reply?.error) return reply.error(message);
    return api.sendMessage({ msg: message }, event.threadId, event.type);
  } finally { cleanupLater(cardPath); }
}
module.exports.run = async function ({ api, event, args = [], Threads, reply }) {
  if (Number(event?.type) === ThreadType.User) {
    return reply?.error ? reply.error("Lệnh /welcome chỉ dùng trong nhóm.") :
      api.sendMessage({ msg: "Lệnh /welcome chỉ dùng trong nhóm." }, event.threadId, event.type);
  }
  if (!Threads?.getData || !Threads?.setData) {
    return reply?.error ? reply.error("Không truy cập được cấu hình nhóm.") :
      api.sendMessage({ msg: "Không truy cập được cấu hình nhóm." }, event.threadId, event.type);
  }
  const action = String(args[0] || "status").toLowerCase(), prefix = String(global.config?.prefix || "/");
  const record = await Threads.getData(event.threadId);
  const thread = record?.data && typeof record.data === "object" ? record.data : {};
  const enabled = Boolean(thread.event_welcome);
  const common = { prefix, groupName: groupName(event), botName: global.config?.name_bot || "JOHNTRAN" };
  if (["on", "off"].includes(action)) {
    thread.event_welcome = action === "on"; await Threads.setData(event.threadId, thread);
    return sendCard({ api, event, reply, spec: { ...common, mode: "status", enabled: thread.event_welcome } });
  }
  if (["test", "preview", "xem", "demo"].includes(action)) {
    return sendCard({ api, event, reply, spec: { ...common, mode: "welcome", member: requester(event) } });
  }
  if (["status", "help"].includes(action)) {
    return sendCard({ api, event, reply, spec: { ...common, mode: "status", enabled } });
  }
  const usage = prefix + "welcome | " + prefix + "welcome on|off | " + prefix + "welcome test";
  return reply?.error ? reply.error("Cách dùng: " + usage) :
    api.sendMessage({ msg: "Cách dùng: " + usage }, event.threadId, event.type);
};
module.exports._test = { groupName, requester, cleanupLater };
