"use strict";

const fs = require("fs");
const stats = require("../../core/stats");
const { collectDeviceMetrics } = require("../../core/runtime/deviceMetrics");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "status",
  aliases: ["tinhtrang", "system"],
  version: "2.1.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Bảng trạng thái bot và thiết bị theo thiết kế chuẩn",
  category: "MyBot",
  usage: "status",
  cooldowns: 8,
  dependencies: { canvas: "" }
};

function currentGroup(api, event, Threads, threadData) {
  const id = String(event?.threadId || "");
  // Zalo ThreadType.User = 0 and ThreadType.Group = 1.
  const isPrivate = Number(event?.type) === 0;
  const record = threadData || Threads.getCachedData?.(id) || null;
  // Bot is enabled by default; only explicit false means disabled.
  const enabled = record?.data?.bot_enabled !== false;

  const cachedInfo = !isPrivate ? stats.getCachedGroupInfo(id) : null;
  const cachedGroup = cachedInfo?.gridInfoMap?.[id];
  const eventName = event?.data?.threadName || event?.data?.groupName || event?.threadName;
  const name = isPrivate
    ? "Tin nhắn riêng"
    : String(eventName || cachedGroup?.name || "Nhóm hiện tại");

  // Warm the group name in the background; the status card never waits on Zalo.
  if (!isPrivate && !cachedGroup && typeof api?.getGroupInfo === "function") {
    void stats.warmGroupInfo(api, id).catch(() => {});
  }

  return { name, id, enabled };
}

function formatUptime(seconds) {
  let value = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(value / 86400);
  value %= 86400;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return (days ? days + " ngày " : "") + hours + " giờ " + minutes + " phút";
}

module.exports.run = async function ({ api, event, Threads, threadData, reply }) {
  let imagePath;
  try {
    // Use the last known bot profile immediately. A missing/stale profile is
    // refreshed in the background instead of blocking the user's status query.
    let profile = stats.getCachedProfile();
    if (!profile) {
      void stats.getProfile(api).catch(() => {});
    }

    const device = collectDeviceMetrics();
    const group = currentGroup(api, event, Threads, threadData);

    imagePath = await renderCanvas("status", {
      botName: profile?.displayName || global.config?.name_bot || "JOHNTRAN",
      botAvatar: profile?.avatar || "",
      device,
      group,
      uptime: formatUptime(process.uptime()),
      version: require("../../package.json").version
    }, { timeout: 30000, poolSize: 2 });

    return await api.sendMessage({
      msg: "",
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[STATUS]", error?.stack || error);
    const msg = "Không thể tạo bảng status: " + (error?.message || "Lỗi");
    return reply?.error
      ? reply.error(msg)
      : api.sendMessage({ msg }, event.threadId, event.type);
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
};

module.exports._test = { currentGroup, formatUptime };
