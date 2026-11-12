"use strict";

const PROFILE_TTL_MS = 5 * 60 * 1000;
const MAX_PROFILES = 1000;
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

function fetchProfileInBackground(api, uid, fallback) {
  if (!uid || !api || typeof api.getUserInfo !== "function") return null;
  if (pending.has(uid)) return pending.get(uid);

  const request = Promise.resolve()
    .then(() => api.getUserInfo(uid))
    .then((response) => {
      const profilesMap = response?.changed_profiles || response?.profiles || response?.userInfo || response;
      const profile = profilesMap?.[uid] || profilesMap?.[String(uid)] || profilesMap;
      const name = String(pickName(profile, fallback.requesterName)).slice(0, 32);
      const avatarUrl = pickAvatar(profile) || fallback.requesterAvatarUrl;
      if (name || avatarUrl) {
        touch(uid, {
          requesterName: name || "Người dùng",
          requesterAvatarUrl: avatarUrl || "",
          expiresAt: Date.now() + PROFILE_TTL_MS
        });
      }
      return { requesterName: name || "Người dùng", requesterAvatarUrl: avatarUrl || "" };
    })
    .catch(() => null)
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
    return {
      requesterName: cached.requesterName || fallback.requesterName,
      requesterAvatarUrl: cached.requesterAvatarUrl || fallback.requesterAvatarUrl
    };
  }

  // Do not wait for a remote profile lookup just to draw a menu/folder card.
  // The current event already provides a usable name; the real avatar/name is
  // fetched in the background and becomes available for the next interaction.
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
  MAX_PROFILES
};
