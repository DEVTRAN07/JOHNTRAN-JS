"use strict";

const { pickAvatar, pickAvatarByUid, uidMatches } = require("./runtime/avatarUrl");
const AVATAR_LARGE = 240;

// Resolve only a record that can be tied to the requested UID. In particular,
// never guess the only record in a response: a changed API envelope can contain
// a different user's profile and silently show the wrong avatar/name.
function pickUser(info, uid) {
  const target = String(uid || "").trim();
  if (!info || !target) return null;

  const queue = [info];
  const visited = new Set();
  let inspected = 0;

  while (queue.length && inspected < 120) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    inspected++;

    if (Array.isArray(current)) {
      const match = current.find(item =>
        item && typeof item === "object" &&
        uidMatches(item.userId ?? item.user_id ?? item.uid, target)
      );
      if (match) return match;
      for (const item of current) {
        if (item && typeof item === "object") queue.push(item);
      }
      continue;
    }

    const directId = current.userId ?? current.user_id ?? current.uid;
    if (directId != null && String(directId)) {
      if (uidMatches(directId, target)) return current;
      continue;
    }

    for (const mapName of ["changed_profiles", "unchanged_profiles", "profiles", "users"]) {
      const map = current[mapName];
      if (!map || typeof map !== "object") continue;

      if (Array.isArray(map)) {
        const match = map.find(item =>
          item && typeof item === "object" &&
          uidMatches(item.userId ?? item.user_id ?? item.uid, target)
        );
        if (match) return match;
      } else {
        const matchingKey = Object.keys(map).find(key => uidMatches(key, target));
        if (matchingKey) return map[matchingKey] || null;
      }
    }

    const matchingKey = Object.keys(current).find(key =>
      uidMatches(key, target) && current[key] && typeof current[key] === "object"
    );
    if (matchingKey) return current[matchingKey];

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

async function fetchProfile(api, uid) {
  let raw;
  let usedAvatarSize = true;
  try {
    raw = await api.getUserInfo(String(uid), AVATAR_LARGE);
  } catch (error) {
    usedAvatarSize = false;
    try {
      raw = await api.getUserInfo(String(uid));
    } catch {
      throw error;
    }
  }

  const user = pickUser(raw, String(uid));
  if (user && typeof api.getAvatarUrlProfile === "function" && !pickAvatar(user)) {
    try {
      const avatarResponse = await api.getAvatarUrlProfile(String(uid), AVATAR_LARGE);
      const avatarUrl = pickAvatarByUid(avatarResponse, String(uid));
      if (avatarUrl) user.avatar = avatarUrl;
    } catch {
      // Avatar is optional: keep the profile and let the card draw initials.
    }
  }

  if (!user) {
    const cp = raw?.changed_profiles;
    const up = raw?.unchanged_profiles;
    const detail = [
      "avatarSize=" + (usedAvatarSize ? AVATAR_LARGE : "mặc định"),
      "keys=" + Object.keys(raw || {}).join(","),
      "changed_keys=" + (cp ? Object.keys(cp).join(",") : "không có"),
      "changed_isArr=" + Array.isArray(cp),
      "unchanged_keys=" + (up ? Object.keys(up).join(",") : "không có")
    ].join(" | ");
    console.error("[zaloProfile] " + uid + " KHÔNG tra được user: " + detail);
  }
  return { user, raw };
}

module.exports = { pickUser, fetchProfile, AVATAR_LARGE, uidMatches };
