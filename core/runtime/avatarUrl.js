"use strict";

// Lightweight, UID-aware avatar extraction shared across commands and Canvas.
const AVATAR_FIELDS = [
  "url", "href", "avatar", "avatarUrl", "avatar_url", "avatarURL", "avatarUri", "avatar_uri",
  "photoUrl", "photo_url", "profilePicture", "profile_picture",
  "profilePictureUrl", "profile_picture_url", "hdAvatar", "hd_avatar",
  "largeAvatar", "large_avatar", "fullAvatar", "full_avatar",
  "imageUrl", "image_url", "src"
];
const EXPLICIT_AVATAR_FIELDS = [
  "avatar", "avatarUrl", "avatar_url", "avatarURL", "avatarUri", "avatar_uri",
  "profilePicture", "profile_picture", "profilePictureUrl", "profile_picture_url",
  "hdAvatar", "hd_avatar", "largeAvatar", "large_avatar", "fullAvatar", "full_avatar"
];

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function pickAvatar(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (isHttpUrl(value)) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const avatar = pickAvatar(item, depth + 1);
      if (avatar) return avatar;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  for (const key of AVATAR_FIELDS) {
    const candidate = value[key];
    if (isHttpUrl(candidate)) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = pickAvatar(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return "";
}

// Event payloads may include media URLs; only inspect fields explicitly
// associated with a person's profile, never generic url/href/src properties.
function pickExplicitAvatar(value, depth = 0) {
  if (!value || depth > 4 || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = pickExplicitAvatar(item, depth + 1);
      if (result) return result;
    }
    return "";
  }

  for (const key of EXPLICIT_AVATAR_FIELDS) {
    const candidate = value[key];
    if (isHttpUrl(candidate)) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      // Once inside an explicitly named avatar field, generic URL properties
      // such as { url: "..." } are safe to interpret as the actual avatar.
      const nested = pickAvatar(candidate, depth + 1);
      if (nested) return nested;
    }
  }

  for (const key of ["profile", "user", "sender", "author", "userProfile", "user_profile"]) {
    const nested = value[key];
    if (nested && typeof nested === "object") {
      const result = pickExplicitAvatar(nested, depth + 1);
      if (result) return result;
    }
  }
  return "";
}

function uidMatches(candidate, uid) {
  const id = String(candidate || "");
  const target = String(uid || "");
  return Boolean(target && (
    id === target ||
    id === target + "_0" ||
    id.startsWith(target + "_")
  ));
}

function isUidRecordKey(key) {
  const value = String(key || "");
  return /^\d{5,}$/.test(value) || /.+_0$/.test(value);
}

function pickAvatarByUid(response, uid) {
  const target = String(uid || "").trim();
  if (!target || response == null) return "";
  if (isHttpUrl(response)) return response.trim();
  if (typeof response !== "object") return "";

  const queue = [response];
  const visited = new Set();
  let inspected = 0;
  let sawUidScopedRecord = false;

  while (queue.length && inspected < 160) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    inspected++;

    if (Array.isArray(current)) {
      const identified = current.filter(item =>
        item && typeof item === "object" &&
        (item.userId != null || item.user_id != null || item.uid != null)
      );
      if (identified.length) {
        sawUidScopedRecord = true;
        const match = identified.find(item => uidMatches(
          item.userId ?? item.user_id ?? item.uid, target
        ));
        if (match) return pickAvatar(match);
      } else {
        for (const item of current) {
          if (item && typeof item === "object") queue.push(item);
        }
      }
      continue;
    }

    const recordId = current.userId ?? current.user_id ?? current.uid;
    if (recordId != null && String(recordId)) {
      sawUidScopedRecord = true;
      if (uidMatches(recordId, target)) return pickAvatar(current);
      // Never read an avatar from an explicitly different user's record.
      continue;
    }

    const entries = Object.entries(current);
    const uidEntries = entries.filter(([key, value]) =>
      value && typeof value === "object" && isUidRecordKey(key)
    );
    if (uidEntries.length) {
      sawUidScopedRecord = true;
      const match = uidEntries.find(([key]) => uidMatches(key, target));
      if (match) {
        const avatar = pickAvatar(match[1]);
        if (avatar) return avatar;
        queue.unshift(match[1]);
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  // Single-user avatar endpoints can return only { avatarUrl: "..." }.
  // Accept unkeyed data only when no UID-scoped records were present.
  return sawUidScopedRecord ? "" : pickAvatar(response);
}

module.exports = { pickAvatar, pickExplicitAvatar, pickAvatarByUid, uidMatches };
