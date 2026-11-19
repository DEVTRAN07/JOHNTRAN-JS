"use strict";

const { GroupEventType, ThreadType } = require("zalo-client");
const welcomeCanvas = require("../../core/canvas/welcome");

module.exports.config = {
  name: "welcome",
  event_type: ["group_event"],
  version: "2.0.0",
  author: "JOHNTRAN",
  description: "Tự động chào thành viên mới bằng thẻ Canvas riêng",
  category: "Sự kiện",
  usage: "welcome on|off|test",
  cooldowns: 0
};

function newMembers(eventData) {
  const data = eventData || {};
  const keys = ["updateMembers", "joinMembers", "members", "newMembers"];
  for (const key of keys) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    return value.map(member => {
      if (typeof member === "string" || typeof member === "number") {
        const uid = String(member);
        return { uid, name: "Thành viên mới" };
      }
      const uid = String(member?.id || member?.uid || member?.userId || "").trim();
      const name = String(
        member?.dName ||
        member?.displayName ||
        member?.name ||
        member?.fullName ||
        "Thành viên mới"
      ).trim();
      return { uid, name };
    }).filter(member => member.uid && member.uid !== "[object Object]");
  }
  return [];
}

function isJoinEvent(event, eventType, eventData) {
  const candidates = [
    event?.type,
    event?.act,
    eventType,
    eventData?.act,
    eventData?.type
  ];
  return candidates.some(value => String(value || "").toLowerCase() === GroupEventType.JOIN);
}

function cleanupCard(filePath) {
  if (!filePath) return;
  try { require("node:fs").rmSync(filePath, { force: true }); } catch {}
}

module.exports.run = async function ({
  api,
  event,
  eventType,
  Threads,
  isSelf,
  threadType,
  threadData
}) {
  if (isSelf || event?.isSelf || !isJoinEvent(event, eventType, event?.data)) return;

  const eventData = event?.data || {};
  const threadId = event?.threadId;
  if (!threadId) return;

  const cached = threadData?.data && typeof threadData.data === "object"
    ? threadData.data
    : (threadData && typeof threadData === "object" ? threadData : null);
  const thread = cached || (await Threads.getData(threadId))?.data || {};
  if (!thread.event_welcome) return;

  const members = newMembers(eventData);
  let botId = "";
  try { botId = String(await api.getOwnId?.() || ""); } catch {}
  const joined = members.filter(member => member.uid !== botId);
  if (!joined.length) return;

  const mentionPrefix = "👋 Chào mừng ";
  const mentionText = joined.map(() => "@.").join(" ");
  const caption = mentionPrefix + mentionText + " đến với nhóm!\n🎉 Rất vui được gặp bạn. Chúc bạn có những phút giây vui vẻ cùng mọi người!";
  const mentions = joined.map((member, index) => ({
    pos: mentionPrefix.length + index * 3,
    uid: member.uid,
    len: 2
  }));

  let cardPath = null;
  try {
    cardPath = await welcomeCanvas.renderWelcomeCard({
      mode: "welcome",
      memberNames: joined.map(member => member.name),
      groupName: eventData.groupName || eventData.threadName || "cộng đồng của chúng ta",
      prefix: global.config?.prefix || "/",
      botName: global.config?.name_bot || "JOHNTRAN"
    });

    await api.sendMessage({
      msg: caption,
      mentions,
      attachments: [cardPath],
      ttlKind: "card"
    }, threadId, threadType || ThreadType.Group);
  } catch (error) {
    console.error("[WELCOME_EVENT]", error?.stack || error);
    try {
      await api.sendMessage({ msg: caption }, threadId, threadType || ThreadType.Group);
    } catch {}
  } finally {
    cleanupCard(cardPath);
  }
};

module.exports._test = { newMembers, isJoinEvent };
