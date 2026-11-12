"use strict";

const { pickUser } = require("../zaloProfile");
const avatarCache = require("../canvas/avatarCache");

const PROFILE_TTL_MS = 5 * 60 * 1000;
const PROFILE_RETRY_TTL_MS = 5 * 1000;
const MAX_PROFILES = 1000;
const AVATAR_SIZE = 240;
const profiles = new Map();
const pending = new Map();

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

function pickName(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return value.displayName || value.display_name || value.dName ||
    value.fullName || value.full_name || value.name || fallback;
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

    // Some Zalo builds return { data: { "<uid>_0": { avatarUrl } } },
    // others wrap the same map inside result/profiles/avatars.
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

    // The endpoint is queried for one UID at a time, so a direct URL on the
    // response envelope is safe; nested collections are inspected below.
    const direct = pickAvatar(current);
    if (direct) return direct;

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return "";
}

function pickProfileByUid(response, uid) {
  const queue = [response];
  const visited = new Set();
  let inspected = 0;
  while (queue.length && inspected < 80) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    inspected++;

    const profile = pickUser(current, String(uid));
    if (profile) return profile;

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
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
  if (!url) return Promise.resolve(null);
  // Fetch and decode the image outside the command's critical path. The next
  // card can draw the cached bitmap without waiting for an HTTP request.
  return Promise.resolve(avatarCache.warmAvatar(url)).catch(() => null);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function warmAvatarWithin(url, waitMs) {
  if (!url) return;
  const task = warmAvatar(url);
  if (waitMs > 0) {
    await Promise.race([task, delay(waitMs)]);
  }
}

function fetchProfileInBackground(api, uid, fallback, options = {}) {
  if (!uid || !api || (
    typeof api.getUserInfo !== "function" &&
    typeof api.getAvatarUrlProfile !== "function"
  )) return null;
  if (pending.has(uid)) return pending.get(uid);

  const request = Promise.resolve()
    .then(async () => {
      // getUserInfo may contain only unchanged_profiles, which often has no
      // avatar. Query Zalo's dedicated avatar endpoint in parallel.
      const profileRequest = typeof api.getUserInfo === "function"
        ? Promise.resolve().then(() => api.getUserInfo(uid, AVATAR_SIZE))
        : Promise.resolve(null);
      const avatarRequest = typeof api.getAvatarUrlProfile === "function"
        ? Promise.resolve().then(() => api.getAvatarUrlProfile(uid, AVATAR_SIZE))
        : Promise.resolve(null);
      const [profileResult, avatarResult] = await Promise.allSettled([
        profileRequest,
        avatarRequest
      ]);
      const response = profileResult.status === "fulfilled" ? profileResult.value : null;
      const avatarResponse = avatarResult.status === "fulfilled" ? avatarResult.value : null;
      const remoteProfile = pickProfileByUid(response, uid);
      const name = String(pickName(remoteProfile, fallback.requesterName)).slice(0, 32);
      const avatarUrl = pickAvatar(remoteProfile) ||
        pickAvatarByUid(avatarResponse, uid) ||
        fallback.requesterAvatarUrl;
      const result = {
        requesterName: name || "Người dùng",
        requesterAvatarUrl: avatarUrl || ""
      };

      // A missing avatar is retried quickly; successful URLs are cached longer.
      touch(uid, {
        ...result,
        expiresAt: Date.now() + (avatarUrl ? PROFILE_TTL_MS : PROFILE_RETRY_TTL_MS)
      });
      if (!options.skipAvatarWarm) warmAvatar(result.requesterAvatarUrl);
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

async function getRequesterProfile(api, event, options = {}) {
  const waitMs = Math.min(1800, Math.max(0, Number(options.waitMs) || 0));
  const avatarWaitMs = Math.min(300, Math.max(0, Number(options.avatarWaitMs) || 0));
  const skipAvatarWarm = options.skipAvatarWarm === true;
  const data = event?.data || {};
  const uid = String(data.uidFrom || data.uid || event?.uidFrom || event?.senderID || event?.senderId || "");
  const fallback = {
    requesterName: String(data.dName || data.senderName || event?.senderName || "Người dùng").slice(0, 32),
    requesterAvatarUrl: pickAvatar(data) || pickAvatar(event)
  };

  if (!uid) return fallback;

  const cached = profiles.get(uid);
  if (cached) {
    touch(uid, cached);
    if (cached.expiresAt <= Date.now()) {
      void fetchProfileInBackground(api, uid, fallback, { skipAvatarWarm });
    }
    const result = {
      requesterName: cached.requesterName || fallback.requesterName,
      requesterAvatarUrl: cached.requesterAvatarUrl || fallback.requesterAvatarUrl
    };
    if (!skipAvatarWarm) {
      if (avatarWaitMs > 0) await warmAvatarWithin(result.requesterAvatarUrl, avatarWaitMs);
      else void warmAvatar(result.requesterAvatarUrl);
    }
    return result;
  }

  // Return immediately for normal messages. Visual menu cards may opt into a
  // short bounded wait so the first card can include the requester's avatar.
  const request = fetchProfileInBackground(api, uid, fallback, { skipAvatarWarm });
  if (waitMs > 0 && request) {
    const profile = await Promise.race([request, delay(waitMs).then(() => null)]);
    if (profile) {
      if (!skipAvatarWarm) {
        if (avatarWaitMs > 0) await warmAvatarWithin(profile.requesterAvatarUrl, avatarWaitMs);
        else void warmAvatar(profile.requesterAvatarUrl);
      }
      return profile;
    }
  }
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
  MAX_PROFILES,
  pickAvatar,
  pickAvatarByUid,
  pickProfileByUid
};
