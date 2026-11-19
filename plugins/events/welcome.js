"use strict";

const { GroupEventType, ThreadType } = require("zalo-client");
const { pickUser } = require("../../core/zaloProfile");
const { pickAvatar, pickAvatarByUid } = require("../../core/runtime/avatarUrl");
const welcomeCanvas = require("../../core/canvas/welcome");

module.exports.config = {
  name: "welcome",
  event_type: ["group_event"],
  version: "2.4.0",
  author: "JOHNTRAN",
  description: "Tự động chào/tạm biệt từng thành viên bằng Canvas riêng có ảnh đại diện",
  category: "Sự kiện",
  usage: "welcome on|off | welcome test",
  cooldowns: 0
};

const PROFILE_LOOKUP_TIMEOUT_MS = 1400;
const GROUP_LOOKUP_TIMEOUT_MS = 1100;
const GROUP_NAME_TTL_MS = 5 * 60 * 1000;
const EVENT_DEDUPE_TTL_MS = 30 * 1000;
const MAX_RECENT_EVENTS = 1000;
const groupNameCache = new Map();
const groupNamePending = new Map();
const recentEvents = new Map();

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableGroupName(value) {
  const name = cleanText(value);
  if (!name) return "";
  const normalized = name.toLocaleLowerCase("vi-VN");
  return ["nhóm hiện tại", "nhóm zalo"].includes(normalized) ? "" : name;
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

    // A single Zalo event can occasionally repeat a UID with partial profile
    // fields. Merge those records so each person receives exactly one card.
    const byUid = new Map();
    for (const member of value) {
      let candidate;
      if (typeof member === "string" || typeof member === "number") {
        candidate = { uid: String(member), name: "Thành viên mới", avatarUrl: "" };
      } else {
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
        candidate = { uid, name, avatarUrl };
      }

      if (!candidate.uid || candidate.uid === "[object Object]") continue;
      const previous = byUid.get(candidate.uid);
      if (!previous) {
        byUid.set(candidate.uid, candidate);
        continue;
      }
      if ((!previous.name || previous.name === "Thành viên mới") &&
          candidate.name && candidate.name !== "Thành viên mới") {
        previous.name = candidate.name;
      }
      if (!previous.avatarUrl && candidate.avatarUrl) previous.avatarUrl = candidate.avatarUrl;
    }
    return [...byUid.values()];
  }
  return [];
}

function eventKind(event, eventType, eventData) {
  const values = [event?.type, event?.act, eventType, eventData?.act, eventData?.type]
    .map(value => String(value || "").toLowerCase());
  if (values.includes(GroupEventType.JOIN)) return "welcome";
  if (
    values.includes(GroupEventType.LEAVE) ||
    values.includes(GroupEventType.REMOVE_MEMBER) ||
    values.includes(GroupEventType.BLOCK_MEMBER)
  ) return "goodbye";
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

function extractGroupName(response, threadId) {
  if (!response || typeof response !== "object") return "";
  const id = String(threadId || "");
  const maps = [
    response.gridInfoMap,
    response.data?.gridInfoMap,
    response.result?.gridInfoMap,
    response.data?.data?.gridInfoMap,
    response.groups,
    response.data?.groups
  ];
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    const info = map[id] || map[threadId];
    const name = usableGroupName(
      typeof info === "string" ? info :
        info?.name || info?.groupName || info?.title || info?.displayName
    );
    if (name) return name;
  }
  return usableGroupName(
    response.name || response.groupName || response.data?.name ||
    response.data?.groupName
  );
}

async function resolveGroupName(api, event) {
  const data = event?.data || {};
  const directNames = [
    data.groupName,
    data.threadName,
    event?.threadName,
    event?.groupName
  ];
  for (const value of directNames) {
    const name = usableGroupName(value);
    if (name) return name;
  }

  const threadId = String(event?.threadId || data.groupId || data.group_id || "");
  if (!threadId) return "Nhóm Zalo";

  const cached = groupNameCache.get(threadId);
  if (cached && cached.expiresAt > Date.now()) return cached.name;
  if (cached) groupNameCache.delete(threadId);

  if (typeof api?.getGroupInfo !== "function") {
    return "Nhóm Zalo · " + threadId.slice(-8);
  }

  let pending = groupNamePending.get(threadId);
  if (!pending) {
    pending = settleWithin(
      Promise.resolve().then(() => api.getGroupInfo(threadId)),
      GROUP_LOOKUP_TIMEOUT_MS
    ).then(response => {
      const name = extractGroupName(response, threadId);
      if (name) {
        groupNameCache.set(threadId, {
          name,
          expiresAt: Date.now() + GROUP_NAME_TTL_MS
        });
        while (groupNameCache.size > MAX_RECENT_EVENTS) {
          groupNameCache.delete(groupNameCache.keys().next().value);
        }
      }
      return name;
    }).catch(() => "").finally(() => {
      groupNamePending.delete(threadId);
    });
    groupNamePending.set(threadId, pending);
  }

  const name = await pending;
  return name || ("Nhóm Zalo · " + threadId.slice(-8));
}

function eventFingerprint(event, kind, members) {
  const data = event?.data || {};
  const time = cleanText(data.time || data.timestamp || event?.time);
  const eventId = cleanText(data.eventId || data.clientId || event?.eventId);
  const sourceId = cleanText(data.sourceId || data.creatorId || event?.sourceId);
  const memberIds = (Array.isArray(members) ? members : [])
    .map(member => String(member?.uid || "").trim())
    .filter(Boolean)
    .sort()
    .join(",");
  // Only suppress a replay when the payload contains a stable event identity.
  // This avoids suppressing legitimate events with incomplete payloads.
  if (!time && !eventId && !sourceId) return "";
  return JSON.stringify([
    String(event?.threadId || data.groupId || ""),
    kind,
    eventId,
    time,
    sourceId,
    memberIds
  ]);
}

function isDuplicateEvent(event, kind, members) {
  const key = eventFingerprint(event, kind, members);
  if (!key) return false;

  const now = Date.now();
  for (const [storedKey, timestamp] of recentEvents) {
    if (now - timestamp > EVENT_DEDUPE_TTL_MS) recentEvents.delete(storedKey);
  }
  if (recentEvents.has(key)) return true;

  recentEvents.set(key, now);
  while (recentEvents.size > MAX_RECENT_EVENTS) {
    recentEvents.delete(recentEvents.keys().next().value);
  }
  return false;
}

function profileName(profile, fallback) {
  return cleanText(
    profile?.displayName || profile?.display_name || profile?.dName ||
    profile?.fullName || profile?.full_name || profile?.name,
    fallback
  );
}

function needsProfile(member) {
  return !member?.avatarUrl ||
    !cleanText(member?.name) ||
    cleanText(member?.name) === "Thành viên mới";
}

/**
 * Resolve only missing profile fields in batches. JOIN prefers current group
 * members; OUT uses the general user profile because the person is no longer
 * present in the group. The avatar-only API is a last resort.
 */
async function hydrateMemberProfiles(api, members, options = {}) {
  const list = Array.isArray(members) ? members : [];
  const targets = list.filter(member => member?.uid && needsProfile(member));
  if (!targets.length) return list;

  const timeoutMs = Math.min(
    2200,
    Math.max(250, Number(options.timeoutMs) || PROFILE_LOOKUP_TIMEOUT_MS)
  );
  const ids = targets.map(member => String(member.uid));

  if (options.includeGroupMembers !== false && typeof api?.getGroupMembersInfo === "function") {
    const response = await settleWithin(
      Promise.resolve().then(() => api.getGroupMembersInfo(ids)),
      timeoutMs
    );
    for (const member of targets) {
      const profile = pickUser(response, member.uid);
      if (!profile) continue;
      member.name = profileName(profile, member.name);
      const avatarUrl = normalizeAvatar(
        profile.avatar, profile.avatarUrl, profile.avatar_25, profile.photoUrl
      );
      if (avatarUrl) member.avatarUrl = avatarUrl;
    }
  }

  const needUserProfile = targets.filter(needsProfile);
  if (needUserProfile.length && typeof api?.getUserInfo === "function") {
    const userIds = needUserProfile.map(member => String(member.uid));
    const response = await settleWithin(
      Promise.resolve().then(() => api.getUserInfo(userIds, 240)),
      timeoutMs
    );
    for (const member of needUserProfile) {
      const profile = pickUser(response, member.uid);
      if (!profile) continue;
      member.name = profileName(profile, member.name);
      const avatarUrl = normalizeAvatar(
        profile.avatar, profile.avatarUrl, profile.avatar_25, profile.photoUrl
      );
      if (avatarUrl) member.avatarUrl = avatarUrl;
    }
  }

  const needAvatar = targets.filter(member => !member.avatarUrl);
  if (needAvatar.length && typeof api?.getAvatarUrlProfile === "function") {
    const avatarIds = needAvatar.map(member => String(member.uid));
    const response = await settleWithin(
      Promise.resolve().then(() => api.getAvatarUrlProfile(avatarIds, 240)),
      timeoutMs
    );
    for (const member of needAvatar) {
      const avatarUrl = pickAvatarByUid(response, member.uid);
      if (avatarUrl) member.avatarUrl = avatarUrl;
    }
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

  const threadId = event?.threadId || eventData.groupId || eventData.group_id;
  if (!threadId) return;

  const cached = threadData?.data && typeof threadData.data === "object"
    ? threadData.data
    : (threadData && typeof threadData === "object" ? threadData : null);
  const thread = cached || (await Threads.getData(threadId))?.data || {};
  // One group-wide switch now controls both JOIN and OUT. Treat event_welcome
  // as the master flag so groups that previously enabled JOIN automatically
  // receive OUT after this update, even if the legacy event_goodbye field is false.
  const enabled = thread.event_welcome === true;
  if (!enabled) return;

  const members = newMembers(eventData);
  let botId = "";
  try { botId = String(await api.getOwnId?.() || ""); } catch {}
  const joined = members.filter(member => member.uid !== botId);
  if (!joined.length || isDuplicateEvent(event, kind, joined)) return;

  // Resolve group name in parallel with member profile hydration so an API
  // fallback does not add another full network round-trip to the event path.
  const groupNamePromise = resolveGroupName(api, event);
  try {
    await hydrateMemberProfiles(api, joined, { includeGroupMembers: kind === "welcome" });
  } catch (error) {
    console.warn("[WELCOME_PROFILE]", error?.message || error);
  }

  const groupName = await groupNamePromise;
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

    // Send the Canvas as its own bubble first. The personalized @mention is a
    // second text bubble so it always appears directly below the person's card.
    if (cardPath) {
      try {
        await api.sendMessage({
          msg: "",
          attachments: [cardPath],
          ttlKind: "card"
        }, threadId, threadType || ThreadType.Group);
      } catch (error) {
        console.error("[WELCOME_CARD_SEND]", member.uid, error?.stack || error);
      } finally {
        cleanupCard(cardPath);
      }
    }

    try {
      await api.sendMessage(message, threadId, threadType || ThreadType.Group);
    } catch (error) {
      console.error("[WELCOME_TAG_SEND]", member.uid, error?.stack || error);
    }
  }
};

function clearWelcomeEventCaches() {
  groupNameCache.clear();
  groupNamePending.clear();
  recentEvents.clear();
}

module.exports._test = {
  newMembers,
  eventKind,
  eventFingerprint,
  isDuplicateEvent,
  makePersonalMessage,
  normalizeAvatar,
  extractGroupName,
  resolveGroupName,
  needsProfile,
  hydrateMemberProfiles,
  clearWelcomeEventCaches,
  PROFILE_LOOKUP_TIMEOUT_MS,
  GROUP_LOOKUP_TIMEOUT_MS,
  GROUP_NAME_TTL_MS,
  EVENT_DEDUPE_TTL_MS
};
