"use strict";

const avatarCache = require("./avatarCache");

const AVATAR_PRELOAD_TIMEOUT_MS = 2100;
const MAX_CARD_AVATARS = 10;
const MAX_GROUP_AVATARS = 12;

async function prepareRequesterAvatar(data) {
  const url = String(data?.requesterAvatarUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const image = await avatarCache.warmAvatar(url, {
      timeout: AVATAR_PRELOAD_TIMEOUT_MS
    });
    return Boolean(image);
  } catch {
    return false;
  }
}

function collectAvatarUrls(type, data = {}) {
  if (type === "menu" || type === "menu-folder") {
    return [data.requesterAvatarUrl];
  }
  if (type === "ghepchu") {
    return [data.requesterAvatarUrl];
  }
  if (type === "status") {
    return [data.botAvatar];
  }
  if (type === "topchat") {
    return (Array.isArray(data.ranking) ? data.ranking : [])
      .slice(0, MAX_CARD_AVATARS)
      .map(item => item?.avatar);
  }
  if (type === "bot-groups") {
    return [
      data.botAvatar,
      ...(Array.isArray(data.groups) ? data.groups : [])
        .slice(0, MAX_GROUP_AVATARS)
        .map(item => item?.avatar)
    ];
  }
  if (type === "tlmn") {
    return (Array.isArray(data.room?.players) ? data.room.players : [])
      .slice(0, 4)
      .filter(item => !item?.ai)
      .map(item => item?.avatarUrl);
  }
  return [];
}

async function prepareCanvasAvatars(type, data = {}) {
  const urls = [...new Set(collectAvatarUrls(type, data)
    .map(url => String(url || "").trim())
    .filter(url => /^https?:\/\//i.test(url)))];

  if (!urls.length) return { requested: 0, loaded: 0 };
  const results = await Promise.all(urls.map(url => prepareRequesterAvatar({
    requesterAvatarUrl: url
  })));
  return {
    requested: urls.length,
    loaded: results.filter(Boolean).length
  };
}

module.exports = {
  prepareRequesterAvatar,
  prepareCanvasAvatars,
  collectAvatarUrls,
  AVATAR_PRELOAD_TIMEOUT_MS,
  MAX_CARD_AVATARS,
  MAX_GROUP_AVATARS
};
