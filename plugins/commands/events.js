"use strict";

const fs = require("fs");
const { ThreadType } = require("zalo-client");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { sendAntiToggleNotice } = require("../../core/runtime/antiToggle");

const EVENTS = [
  { key: "welcome", label: "Chào thành viên mới", field: "event_welcome" },
  { key: "bye", label: "Tạm biệt thành viên rời nhóm", field: "event_bye" },
  { key: "rank", label: "Level / EXP theo tin nhắn", field: "event_rank" },
  { key: "guard", label: "Cảnh cáo link lạ và từ cấm", field: "event_guard" }
];

module.exports.config = {
  name: "events",
  aliases: ["event", "sk"],
  version: "2.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Bật/tắt sự kiện tự động của bot",
  category: "Hệ thống",
  usage: "events [tên] on|off | events guard allow <host>",
  cooldowns: 3,
  dependencies: { canvas: "" }
};

function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => { try { fs.rmSync(filePath, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}

function statusText(thread, prefix) {
  return [
    "Bật tắt: " + prefix + "events <tên> on|off",
    "Tên: " + EVENTS.map(item => item.key).join(" | "),
    "",
    ...EVENTS.map(item => "• " + item.label + ": " + (thread[item.field] ? "BẬT ✅" : "TẮT ❌"))
  ].join("\n");
}

async function sendStatusCard({ api, event, reply, thread }) {
  const fallback = statusText(thread, (global.config?.prefix || "/"));
  let imagePath;
  try {
    imagePath = await renderCanvas("events", {
      mode: "status",
      prefix: (global.config?.prefix || "/") || "/",
      events: EVENTS.map(item => ({
        key: item.key,
        label: item.label,
        enabled: Boolean(thread[item.field])
      }))
    }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[EVENTS_CANVAS]", error?.stack || error);
    return reply.info(fallback, {
      title: "SỰ KIỆN NHÓM NÀY",
      rows: [{ label: "Trạng thái", lines: EVENTS.map(item => "• " + item.label + ": " + (thread[item.field] ? "BẬT ✅" : "TẮT ❌")) }]
    });
  } finally { cleanupLater(imagePath); }
}

async function sendHostsCard({ api, event, reply, hosts }) {
  const prefix = (global.config?.prefix || "/") || "/";
  const fallback = "Danh sách host được phép:\n" + (hosts.length ? hosts.map(host => "• " + host).join("\n") : "Chưa thêm host nào. Bot đang dùng danh sách mặc định.") +
    "\n\nThêm host: " + prefix + "events guard allow <host>";
  let imagePath;
  try {
    imagePath = await renderCanvas("events", { mode: "hosts", hosts, prefix }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[EVENTS_HOSTS_CANVAS]", error?.stack || error);
    return reply.info(fallback, {
      title: "HOST ĐƯỢC PHÉP",
      rows: [{ label: "Danh sách", lines: hosts.length ? hosts.map(host => "✅ " + host) : ["Chưa thêm host nào — chỉ dùng danh sách mặc định"] }]
    });
  } finally { cleanupLater(imagePath); }
}

module.exports.run = async function ({ api, event, args, Threads, reply }) {
  const { threadId, type } = event;
  if (type === ThreadType.User) return reply.error("Lệnh chỉ dùng trong nhóm.");

  const target = EVENTS.find(item => item.key === String(args[0] || "").toLowerCase());
  if (!args[0] || !target) {
    const thread = (await Threads.getData(threadId)).data || {};
    return sendStatusCard({ api, event, reply, thread });
  }

  const action = String(args[1] || "").toLowerCase();
  if (target.key === "guard" && ["allow", "allowed", "host", "hosts"].includes(action)) {
    const thread = (await Threads.getData(threadId)).data || {};
    const hosts = Array.isArray(thread.guard_allowed_hosts) ? thread.guard_allowed_hosts : [];
    if (action === "allow" && args[2]) {
      const host = String(args[2]).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!hosts.includes(host)) hosts.push(host);
      thread.guard_allowed_hosts = hosts;
      await Threads.setData(threadId, thread);
      return reply.success("Đã cho phép host: " + host);
    }
    return sendHostsCard({ api, event, reply, hosts });
  }

  if (action !== "on" && action !== "off") {
    return reply.error("Thiếu trạng thái. Dùng: " + (global.config?.prefix || "/") + "events " + target.key + " on|off");
  }

  const thread = (await Threads.getData(threadId)).data || {};
  const enabled = action === "on";
  thread[target.field] = enabled;
  await Threads.setData(threadId, thread);

  if (target.key === "guard") {
    return sendAntiToggleNotice(api, threadId, type, {
      label: "Anti-Guard",
      enabled,
      detail: "Quét link lạ, link mời nhóm Zalo và từ cấm; 3 lần cảnh cáo, vi phạm lần thứ 4 mới kick."
    });
  }
  return reply.success(target.label + " đã " + (enabled ? "BẬT" : "TẮT") + ".");
};

module.exports._test = { EVENTS, statusText };
