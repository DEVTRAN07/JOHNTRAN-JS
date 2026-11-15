"use strict";

// Lightweight URL extraction shared by realtime listeners, stats and Canvas.
// Keep this module free of network, Canvas and database imports.
function pickAvatar(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") return /^https?:\/\//i.test(value.trim()) ? value.trim() : "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const avatar = pickAvatar(item, depth + 1);
      if (avatar) return avatar;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  const fields = [
    "url", "href", "avatar", "avatarUrl", "avatar_url", "photoUrl",
    "photo_url", "profilePicture", "profile_picture", "hdAvatar",
    "hd_avatar", "largeAvatar", "large_avatar", "fullAvatar",
    "full_avatar", "avatarURL", "imageUrl", "image_url", "src"
  ];
  for (const key of fields) {
    const candidate = value[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const nested = pickAvatar(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function pickAvatarByUid(response, uid) {
  if (!response || typeof response !== "object") {
    return typeof response === "string" && /^https?:\/\//i.test(response) ? response : "";
  }

  const userId = String(uid);
  const expectedIds = new Set([userId, userId + "_0"]);
  const queue = [response];
  const visited = new Set();
  let inspected = 0;

  while (queue.length && inspected < 120) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    inspected++;

    if (Array.isArray(current)) {
      const matched = current.find(item => {
        if (!item || typeof item !== "object") return false;
        const id = String(item.userId ?? item.user_id ?? item.uid ?? item.id ?? "");
        return expectedIds.has(id) || id.startsWith(userId + "_");
      });
      if (matched) {
        const avatar = pickAvatar(matched);
        if (avatar) return avatar;
        queue.unshift(matched);
      } else if (current.length === 1) {
        queue.push(current[0]);
      }
      continue;
    }

    for (const key of expectedIds) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        const avatar = pickAvatar(current[key]);
        if (avatar) return avatar;
        queue.unshift(current[key]);
      }
    }

    const recordId = String(current.userId ?? current.user_id ?? current.uid ?? current.id ?? "");
    if (recordId && (expectedIds.has(recordId) || recordId.startsWith(userId + "_"))) {
      const avatar = pickAvatar(current);
      if (avatar) return avatar;
    }

    const direct = pickAvatar(current);
    if (direct) return direct;

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

module.exports = { pickAvatar, pickAvatarByUid };
