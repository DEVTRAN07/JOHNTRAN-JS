"use strict";

const { GroupEventType, ThreadType } = require("zalo-client");
const { pickUser } = require("../../core/zaloProfile");
const { pickAvatar, pickAvatarByUid } = require("../../core/runtime/avatarUrl");
const welcomeCanvas = require("../../core/canvas/welcome");

module.exports.config = {
  name: "welcome",
  event_type: ["group_event"],
  version: "2.2.0",
  author: "JOHNTRAN",
  description: "Tự động chào từng thành viên bằng Canvas riêng có ảnh đại diện",
  category: "Sự kiện",
  usage: "welcome on|off | welcome out on|off | welcome test",
  cooldowns: 0
};

const PROFILE_LOOKUP_TIMEOUT_MS = 1400;

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAvatar(...values) {
  for (const value of values) {
    const url = pickAvatar(value);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function newMembers(eventData) {
  const data = eventData || {};
  for (const key of ["updateMembers", "joinMembers", "members", "newMembers"]) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    return value.map(member => {
      if (typeof member === "string" || typeof member === "number") {
        return { uid: String(member), name: "Thành viên mới", avatarUrl: "" };
      }

      const uid = String(member?.id || member?.uid || member?.userId || "").trim();
      const name = cleanText(
        member?.dName || member?.displayName || member?.name || member?.fullName,
        "Thành viên mới"
      );
      // Try all avatar fields independently: an invalid full avatar must not
      // mask a valid avatar_25 URL.
      const avatarUrl = normalizeAvatar(
        member?.avatar,
        member?.avatarUrl,
        member?.avatar_url,
        member?.photoUrl,
        member?.avatar_25,
        member?.profile
      );
      return { uid, name, avatarUrl };
    }).filter(member => member.uid && member.uid !== "[object Object]");
  }
  return [];
}

function eventKind(event, eventType, eventData) {
  const values = [event?.type, event?.act, eventType, eventData?.act, eventData?.type]
    .map(value => String(value || "").toLowerCase());
  if (values.includes(GroupEventType.JOIN)) return "welcome";
  if (values.includes(GroupEventType.LEAVE) || values.includes(GroupEventType.REMOVE_MEMBER)) return "goodbye";
  return "";
}

function settleWithin(task, timeoutMs = PROFILE_LOOKUP_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(task).catch(() => null),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(null), Math.max(0, timeoutMs));
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function profileName(profile, fallback) {
  return cleanText(
    profile?.displayName || profile?.display_name || profile?.dName ||
    profile?.fullName || profile?.full_name || profile?.name,
    fallback
  );
}

/**
 * JOIN events normally carry avatar/avatar_25. When Zalo omits them, resolve
 * all missing images in one batched group-member lookup, not one request each.
 */
async function hydrateMemberProfiles(api, members, options = {}) {
  const list = Array.isArray(members) ? members : [];
  const missing = list.filter(member => member?.uid && !member.avatarUrl);
  if (!missing.length) return list;

  const timeoutMs = Math.min(
    2200,
    Math.max(250, Number(options.timeoutMs) || PROFILE_LOOKUP_TIMEOUT_MS)
  );
  const ids = missing.map(member => String(member.uid));
  let groupProfiles = null;
  let userProfiles = null;
  let avatarProfiles = null;
  const requests = [];

  if (options.includeGroupMembers !== false && typeof api?.getGroupMembersInfo === "function") {
    requests.push(settleWithin(
      Promise.resolve().then(() => api.getGroupMembersInfo(ids)),
      timeoutMs
    ).then(result => { groupProfiles = result; }));
  }
  // Resolve departed users from user profiles because they are no longer in the group.
  if (typeof api?.getUserInfo === "function") {
    requests.push(settleWithin(
      Promise.resolve().then(() => api.getUserInfo(ids, 240)),
      timeoutMs
    ).then(result => { userProfiles = result; }));
  }
  // Fallback for a group-member response whose profile record omits its photo.
  if (typeof api?.getAvatarUrlProfile === "function") {
    requests.push(settleWithin(
      Promise.resolve().then(() => api.getAvatarUrlProfile(ids, 240)),
      timeoutMs
    ).then(result => { avatarProfiles = result; }));
  }
  if (requests.length) await Promise.all(requests);

  for (const member of missing) {
    const profile = pickUser(userProfiles, member.uid) || pickUser(groupProfiles, member.uid);
    const avatarUrl = normalizeAvatar(
      profile?.avatar,
      profile?.avatarUrl,
      profile?.avatar_25,
      profile?.photoUrl
    ) || pickAvatarByUid(avatarProfiles, member.uid);

    if (avatarUrl) member.avatarUrl = avatarUrl;
    if (profile) member.name = profileName(profile, member.name);
  }
  return list;
}

function cleanupCard(filePath) {
  if (!filePath) return;
  try { require("node:fs").rmSync(filePath, { force: true }); } catch {}
}

function makePersonalMessage(member, kind = "welcome") {
  const isGoodbye = kind === "goodbye";
  const prefix = isGoodbye ? "👋 Tạm biệt " : "👋 Chào mừng ";
  const suffix = isGoodbye
    ? " đã rời nhóm. Chúc bạn mọi điều tốt đẹp!"
    : " đến với nhóm!\n🎉 Rất vui được gặp bạn. Chúc bạn có những phút giây vui vẻ cùng mọi người!";
  return {
    msg: prefix + "@." + suffix,
    mentions: [{ pos: prefix.length, uid: member.uid, len: 2 }]
  };
}

module.exports.run = async function ({
  api, event, eventType, Threads, isSelf, threadType, threadData
}) {
  if (isSelf || event?.isSelf) return;
  const eventData = event?.data || {};
  const kind = eventKind(event, eventType, eventData);
  if (!kind) return;

  const threadId = event?.threadId;
  if (!threadId) return;

  const cached = threadData?.data && typeof threadData.data === "object"
    ? threadData.data
    : (threadData && typeof threadData === "object" ? threadData : null);
  const thread = cached || (await Threads.getData(threadId))?.data || {};
  const enabled = kind === "welcome" ? thread.event_welcome === true : thread.event_goodbye === true;
  if (!enabled) return;

  const members = newMembers(eventData);
  let botId = "";
  try { botId = String(await api.getOwnId?.() || ""); } catch {}
  const joined = members.filter(member => member.uid !== botId);
  if (!joined.length) return;

  try {
    await hydrateMemberProfiles(api, joined, { includeGroupMembers: kind === "welcome" });
  } catch (error) {
    console.warn("[WELCOME_PROFILE]", error?.message || error);
  }

  const groupName = cleanText(eventData.groupName || eventData.threadName, "Nhóm Zalo");
  const prefix = global.config?.prefix || "/";
  const botName = global.config?.name_bot || "JOHNTRAN";

  const cards = await Promise.all(joined.map(async member => {
    try {
      return await welcomeCanvas.renderWelcomeCard({
        mode: kind,
        member: { name: member.name, avatarUrl: member.avatarUrl },
        groupName,
        prefix,
        botName
      });
    } catch (error) {
      console.error("[WELCOME_RENDER]", member.uid, error?.message || error);
      return null;
    }
  }));

  for (let index = 0; index < joined.length; index++) {
    const member = joined[index];
    const cardPath = cards[index];
    const message = makePersonalMessage(member, kind);
    const payload = {
      ...message,
      ...(cardPath ? { attachments: [cardPath], ttlKind: "card" } : {})
    };

    try {
      await api.sendMessage(payload, threadId, threadType || ThreadType.Group);
    } catch (error) {
      console.error("[WELCOME_SEND]", member.uid, error?.stack || error);
      if (cardPath) {
        try {
          await api.sendMessage(message, threadId, threadType || ThreadType.Group);
        } catch (fallbackError) {
          console.error("[WELCOME_FALLBACK]", member.uid, fallbackError?.message || fallbackError);
        }
      }
    } finally {
      cleanupCard(cardPath);
    }
  }
};

module.exports._test = {
  newMembers, eventKind, makePersonalMessage, normalizeAvatar,
  hydrateMemberProfiles, PROFILE_LOOKUP_TIMEOUT_MS
};
