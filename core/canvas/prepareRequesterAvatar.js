"use strict";

const avatarCache = require("./avatarCache");

const AVATAR_PRELOAD_TIMEOUT_MS = 550;

async function prepareRequesterAvatar(data) {
  const url = String(data?.requesterAvatarUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;

  try {
    const image = await avatarCache.warmAvatar(url, {
      timeout: AVATAR_PRELOAD_TIMEOUT_MS
    });
    return Boolean(image);
  } catch {
    // If Zalo's CDN is unavailable, the card still renders initials.
    return false;
  }
}

module.exports = { prepareRequesterAvatar, AVATAR_PRELOAD_TIMEOUT_MS };
