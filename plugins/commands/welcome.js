"use strict";

const fs = require("node:fs");
const { ThreadType } = require("zalo-client");
const requesterProfile = require("../../core/runtime/requesterProfile");
const welcomeCanvas = require("../../core/canvas/welcome");

module.exports.config = {
  name: "welcome",
  aliases: ["wel"],
  version: "1.1.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Quản lý lời chào thành viên mới bằng Canvas",
  category: "Quản lý nhóm",
  usage: "welcome | welcome on|off | welcome test",
  cooldowns: 2,
  dependencies: { canvas: "" }
};

const GROUP_LOOKUP_TIMEOUT_MS = 1200;

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanupLater(filePath) {
  if (!filePath) return;
  const timer = setTimeout(() => {
    try { fs.rmSync(filePath, { force: true }); } catch {}
  }, 60000);
  timer.unref?.();
}

function extractGroupName(response, threadId) {
  if (!response || typeof response !== "object") return "";
  const id = String(threadId || "");
  const maps = [
    response.gridInfoMap,
    response.data?.gridInfoMap,
    response.result?.gridInfoMap,
    response.groups,
    response.data?.groups
  ];
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    const info = map[id] || map[threadId];
    const name = cleanText(
      typeof info === "string" ? info :
        info?.name || info?.groupName || info?.title || info?.displayName
    );
    if (name) return name;
  }
  return cleanText(
    response.name || response.groupName || response.data?.name ||
    response.data?.groupName
  );
}

function settleWithin(task, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(task).catch(() => null),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

async function resolveGroupName(api, event, thread, threadData) {
  const data = event?.data || {};
  const candidates = [
    data.groupName,
    data.threadName,
    event?.threadName,
    threadData?.groupName,
    threadData?.threadName,
    threadData?.data?.name,
    threadData?.name,
    thread?.groupName,
    thread?.threadName,
    thread?.name
  ];
  for (const value of candidates) {
    const name = cleanText(value);
    if (name && name !== "Nhóm hiện tại") return name;
  }

  const threadId = String(event?.threadId || "");
  if (threadId && typeof api?.getGroupInfo === "function") {
    const response = await settleWithin(
      Promise.resolve().then(() => api.getGroupInfo(threadId)),
      GROUP_LOOKUP_TIMEOUT_MS
    );
    const name = extractGroupName(response, threadId);
    if (name) return name;
  }
  return threadId ? "Nhóm Zalo · " + threadId.slice(-8) : "Nhóm Zalo";
}

async function requester(api, event) {
  const data = event?.data || {};
  const fallbackName = cleanText(
    data.dName || data.displayName || data.senderName || event?.senderName,
    "Thành viên mới"
  );
  const fallbackAvatar = requesterProfile.pickAvatar
    ? requesterProfile.pickAvatar(data)
    : "";

  try {
    const profile = await requesterProfile.getRequesterProfile(api, event, {
      waitMs: 1100,
      fetchTimeoutMs: 1050,
      avatarWaitMs: 300
    });
    return {
      uid: String(data.uidFrom || data.uid || event?.uidFrom || event?.senderID || event?.senderId || ""),
      name: cleanText(profile?.requesterName, fallbackName),
      avatarUrl: cleanText(profile?.requesterAvatarUrl, fallbackAvatar)
    };
  } catch (error) {
    console.warn("[WELCOME_REQUESTER]", error?.message || error);
    return {
      uid: String(data.uidFrom || data.uid || event?.uidFrom || event?.senderID || event?.senderId || ""),
      name: fallbackName,
      avatarUrl: fallbackAvatar
    };
  }
}

async function sendCard({ api, event, reply, spec, caption }) {
  let cardPath = null;
  try {
    cardPath = await welcomeCanvas.renderWelcomeCard(spec);
    // Zalo displays msg + mentions directly below the attached Canvas image.
    return await api.sendMessage({
      ...(caption || { msg: "" }),
      attachments: [cardPath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    const message = "Không thể tạo Canvas welcome: " + (error?.message || "Lỗi không xác định");
    console.error("[WELCOME_COMMAND]", error?.stack || error);
    if (caption) {
      // Keep the personalized text/tag available even if image rendering fails.
      return api.sendMessage(caption, event.threadId, event.type);
    }
    if (reply?.error) return reply.error(message);
    return api.sendMessage({ msg: message }, event.threadId, event.type);
  } finally {
    cleanupLater(cardPath);
  }
}

function makePersonalMessage(member, kind = "welcome") {
  const isGoodbye = kind === "goodbye";
  const prefix = isGoodbye ? "👋 Tạm biệt " : "👋 Chào mừng ";
  const suffix = isGoodbye
    ? " Chúc bạn mọi điều tốt đẹp!"
    : " đến với nhóm!\n🎉 Rất vui được gặp bạn. Chúc bạn có những phút giây vui vẻ cùng mọi người!";
  const name = cleanText(member?.name, "bạn");
  // The tag is drawn into the image footer so its color is visible in Zalo.
  // It is a visual @name, not an interactive notification mention.
  return { msg: prefix + "@" + name + suffix };
}

async function sendPreview({ api, event, reply, spec, member, mode }) {
  // Attach caption + @mention to the Canvas itself, so Zalo shows the text
  // immediately below the image in the same message bubble.
  const caption = makePersonalMessage(member, mode);
  return sendCard({ api, event, reply, spec, caption });
}

module.exports.run = async function ({
  api, event, args = [], Threads, reply, threadData
}) {
  if (Number(event?.type) === ThreadType.User) {
    return reply?.error
      ? reply.error("Lệnh /welcome chỉ dùng trong nhóm.")
      : api.sendMessage({ msg: "Lệnh /welcome chỉ dùng trong nhóm." }, event.threadId, event.type);
  }

  if (!Threads?.getData || !Threads?.setData) {
    return reply?.error
      ? reply.error("Không truy cập được cấu hình nhóm.")
      : api.sendMessage({ msg: "Không truy cập được cấu hình nhóm." }, event.threadId, event.type);
  }

  const action = String(args[0] || "status").toLowerCase();
  const prefix = String(global.config?.prefix || "/");
  // Listener already resolved this group's record before dispatch. Reuse that
  // snapshot for command reads instead of issuing a second Supabase request.
  const record = threadData && typeof threadData === "object"
    ? threadData
    : await Threads.getData(event.threadId);
  const thread = record?.data && typeof record.data === "object"
    ? record.data
    : record && typeof record === "object" ? record : {};
  // event_welcome is the single master switch for both JOIN and OUT.
  const enabled = Boolean(thread.event_welcome);
  const goodbyeEnabled = enabled;
  const common = {
    prefix,
    groupName: await resolveGroupName(api, event, thread, threadData),
    botName: global.config?.name_bot || "JOHNTRAN"
  };

  if (["on", "off"].includes(action)) {
    const nextEnabled = action === "on";
    thread.event_welcome = nextEnabled;
    // Keep the legacy field synchronized for older status readers/configs.
    thread.event_goodbye = nextEnabled;
    await Threads.setData(event.threadId, thread);
    return sendCard({
      api, event, reply,
      spec: { ...common, mode: "status", enabled: nextEnabled, goodbyeEnabled: nextEnabled }
    });
  }

  // Backward-compatible syntax: /welcome out on|off now toggles the same
  // combined JOIN + OUT switch instead of exposing a second independent toggle.
  if (["out", "leave", "goodbye"].includes(action)) {
    const legacyAction = String(args[1] || "status").toLowerCase();
    if (["on", "off"].includes(legacyAction)) {
      const nextEnabled = legacyAction === "on";
      thread.event_welcome = nextEnabled;
      thread.event_goodbye = nextEnabled;
      await Threads.setData(event.threadId, thread);
    }
    const nextEnabled = Boolean(thread.event_welcome);
    return sendCard({
      api, event, reply,
      spec: { ...common, mode: "status", enabled: nextEnabled, goodbyeEnabled: nextEnabled }
    });
  }

  if (["test", "preview", "xem", "demo"].includes(action)) {
    const member = await requester(api, event);
    const preview = { ...common, member };
    await sendPreview({
      api, event, reply, member,
      spec: { ...preview, mode: "welcome" },
      mode: "welcome"
    });
    return sendPreview({
      api, event, reply, member,
      spec: { ...preview, mode: "goodbye" },
      mode: "goodbye"
    });
  }

  if (["status", "help"].includes(action)) {
    return sendCard({
      api, event, reply,
      spec: { ...common, mode: "status", enabled, goodbyeEnabled }
    });
  }

  const usage = prefix + "welcome | " + prefix + "welcome on|off (JOIN + OUT) | " + prefix + "welcome test";
  return reply?.error
    ? reply.error("Cách dùng: " + usage)
    : api.sendMessage({ msg: "Cách dùng: " + usage }, event.threadId, event.type);
};

module.exports._test = {
  extractGroupName, resolveGroupName, requester, makePersonalMessage, sendPreview,
  cleanupLater, GROUP_LOOKUP_TIMEOUT_MS
};
