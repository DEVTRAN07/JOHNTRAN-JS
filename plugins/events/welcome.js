"use strict";
const { GroupEventType, ThreadType } = require("zalo-client");
const welcomeCanvas = require("../../core/canvas/welcome");
module.exports.config = {
  name: "welcome", event_type: ["group_event"], version: "2.1.0",
  author: "JOHNTRAN", description: "Tự động chào từng thành viên bằng Canvas riêng có ảnh đại diện",
  category: "Sự kiện", usage: "welcome on|off|test", cooldowns: 0
};
function newMembers(eventData) {
  const data = eventData || {};
  for (const key of ["updateMembers", "joinMembers", "members", "newMembers"]) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    return value.map(member => {
      if (typeof member === "string" || typeof member === "number")
        return { uid: String(member), name: "Thành viên mới", avatarUrl: "" };
      const uid = String(member?.id || member?.uid || member?.userId || "").trim();
      const name = String(member?.dName || member?.displayName || member?.name ||
        member?.fullName || "Thành viên mới").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
      const raw = member?.avatar || member?.avatar_25 || member?.avatarUrl || member?.photoUrl || "";
      const avatarUrl = /^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : "";
      return { uid, name, avatarUrl };
    }).filter(member => member.uid && member.uid !== "[object Object]");
  }
  return [];
}
function isJoinEvent(event, eventType, eventData) {
  return [event?.type, event?.act, eventType, eventData?.act, eventData?.type]
    .some(value => String(value || "").toLowerCase() === GroupEventType.JOIN);
}
function cleanupCard(filePath) {
  if (!filePath) return;
  try { require("node:fs").rmSync(filePath, { force: true }); } catch {}
}
function makePersonalMessage(member) {
  const prefix = "👋 Chào mừng ";
  return { msg: prefix + "@. đến với nhóm!\n🎉 Rất vui được gặp bạn. Chúc bạn có những phút giây vui vẻ cùng mọi người!",
    mentions: [{ pos: prefix.length, uid: member.uid, len: 2 }] };
}
module.exports.run = async function ({ api, event, eventType, Threads, isSelf, threadType, threadData }) {
  if (isSelf || event?.isSelf || !isJoinEvent(event, eventType, event?.data)) return;
  const eventData = event?.data || {}, threadId = event?.threadId;
  if (!threadId) return;
  const cached = threadData?.data && typeof threadData.data === "object"
    ? threadData.data : (threadData && typeof threadData === "object" ? threadData : null);
  const thread = cached || (await Threads.getData(threadId))?.data || {};
  if (!thread.event_welcome) return;
  const members = newMembers(eventData);
  let botId = "";
  try { botId = String(await api.getOwnId?.() || ""); } catch {}
  const joined = members.filter(member => member.uid !== botId);
  if (!joined.length) return;
  const groupName = eventData.groupName || eventData.threadName || "cộng đồng của chúng ta";
  const prefix = global.config?.prefix || "/", botName = global.config?.name_bot || "JOHNTRAN";
  // Render separate cards concurrently; send them in event order.
  const cards = await Promise.all(joined.map(async member => {
    try {
      return await welcomeCanvas.renderWelcomeCard({
        mode: "welcome", member: { name: member.name, avatarUrl: member.avatarUrl },
        groupName, prefix, botName
      });
    } catch (error) {
      console.error("[WELCOME_RENDER]", member.uid, error?.message || error);
      return null;
    }
  }));
  for (let index = 0; index < joined.length; index++) {
    const member = joined[index], cardPath = cards[index], message = makePersonalMessage(member);
    const payload = { ...message, ...(cardPath ? { attachments: [cardPath], ttlKind: "card" } : {}) };
    try {
      await api.sendMessage(payload, threadId, threadType || ThreadType.Group);
    } catch (error) {
      console.error("[WELCOME_SEND]", member.uid, error?.stack || error);
      if (cardPath) {
        try { await api.sendMessage(message, threadId, threadType || ThreadType.Group); }
        catch (fallbackError) { console.error("[WELCOME_FALLBACK]", member.uid, fallbackError?.message || fallbackError); }
      }
    } finally { cleanupCard(cardPath); }
  }
};
module.exports._test = { newMembers, isJoinEvent, makePersonalMessage };
