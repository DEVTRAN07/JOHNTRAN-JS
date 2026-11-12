"use strict";

const { pickUser } = require("../zaloProfile");
const avatarCache = require("../canvas/avatarCache");

const PROFILE_TTL_MS = 5 * 60 * 1000;
const PROFILE_RETRY_TTL_MS = 15 * 1000;
const MAX_PROFILES = 1000;
const AVATAR_SIZE = 240;
const profiles = new Map();
const pending = new Map();

function pickAvatar(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return pickAvatar(value[0]);
  if (typeof value !== "object") return "";
  return value.url || value.href || value.avatar || value.avatarUrl || value.avatar_url ||
    value.photoUrl || value.photo_url || value.profilePicture || value.profile_picture || "";
}

function pickName(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return value.displayName || value.dName || value.fullName || value.name || fallback;
}

function touch(uid, entry) {
  profiles.delete(uid);
  profiles.set(uid, entry);
  while (profiles.size > MAX_PROFILES) {
    const oldest = profiles.keys().next().value;
    if (oldest === undefined) break;
    profiles.delete(oldest);
  }
}

function warmAvatar(url) {
  if (!url) return;
  // Fetch and decode the image outside the command's critical path. The next
  // card can draw the cached bitmap without waiting for an HTTP request.
  void avatarCache.warmAvatar(url).catch(() => null);
}

function fetchProfileInBackground(api, uid, fallback) {
  if (!uid || !api || typeof api.getUserInfo !== "function") return null;
  if (pending.has(uid)) return pending.get(uid);

  const request = Promise.resolve()
    // Ask Zalo for a large avatar; its response keys are commonly UID_0,
    // not the bare UID passed to getUserInfo().
    .then(() => api.getUserInfo(uid, AVATAR_SIZE))
    .then((response) => {
      const profile = pickUser(response, uid);
      const name = String(pickName(profile, fallback.requesterName)).slice(0, 32);
      const avatarUrl = pickAvatar(profile) || fallback.requesterAvatarUrl;
      const hasRemoteProfile = Boolean(profile && (
        pickName(profile, "") || pickAvatar(profile)
      ));
      const result = {
        requesterName: name || "Người dùng",
        requesterAvatarUrl: avatarUrl || ""
      };

      // Do not cache a failed lookup for the full profile TTL. A short negative
      // cache prevents repeated calls during bursts but allows later retries.
      touch(uid, {
        ...result,
        expiresAt: Date.now() + (hasRemoteProfile && avatarUrl
          ? PROFILE_TTL_MS
          : PROFILE_RETRY_TTL_MS)
      });
      warmAvatar(result.requesterAvatarUrl);
      return result;
    })
    .catch(() => {
      const previous = profiles.get(uid);
      if (previous) return {
        requesterName: previous.requesterName || fallback.requesterName,
        requesterAvatarUrl: previous.requesterAvatarUrl || fallback.requesterAvatarUrl
      };

      touch(uid, {
        ...fallback,
        expiresAt: Date.now() + PROFILE_RETRY_TTL_MS
      });
      return fallback;
    })
    .finally(() => pending.delete(uid));

  pending.set(uid, request);
  return request;
}

async function getRequesterProfile(api, event) {
  const data = event?.data || {};
  const uid = String(data.uidFrom || event?.senderID || event?.senderId || "");
  const fallback = {
    requesterName: String(data.dName || data.senderName || event?.senderName || "Người dùng").slice(0, 32),
    requesterAvatarUrl: pickAvatar(data) || pickAvatar(event)
  };

  if (!uid) return fallback;

  const cached = profiles.get(uid);
  if (cached) {
    touch(uid, cached);
    if (cached.expiresAt <= Date.now()) {
      void fetchProfileInBackground(api, uid, fallback);
    }
    const result = {
      requesterName: cached.requesterName || fallback.requesterName,
      requesterAvatarUrl: cached.requesterAvatarUrl || fallback.requesterAvatarUrl
    };
    warmAvatar(result.requesterAvatarUrl);
    return result;
  }

  // Return immediately; message listener prefetches this profile on ordinary
  // messages so the avatar is usually ready before the user opens /menu.
  void fetchProfileInBackground(api, uid, fallback);
  return fallback;
}

function clearRequesterProfileCache() {
  profiles.clear();
  pending.clear();
}

module.exports = {
  getRequesterProfile,
  clearRequesterProfileCache,
  PROFILE_TTL_MS,
  PROFILE_RETRY_TTL_MS,
  AVATAR_SIZE,
  MAX_PROFILES
};
