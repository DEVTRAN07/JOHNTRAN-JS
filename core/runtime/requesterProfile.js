"use strict";

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

async function getRequesterProfile(api, event) {
  const data = event?.data || {};
  const uid = data.uidFrom || event?.senderID || event?.senderId;
  let name = String(data.dName || data.senderName || event?.senderName || "Người dùng").slice(0, 32);
  let avatarUrl = pickAvatar(data) || pickAvatar(event);

  if (uid && api && typeof api.getUserInfo === "function") {
    try {
      const response = await api.getUserInfo(String(uid));
      const profiles = response?.changed_profiles || response?.profiles || response?.userInfo || response;
      const profile = profiles?.[String(uid)] || profiles?.[uid] || profiles;
      name = String(pickName(profile, name)).slice(0, 32);
      avatarUrl = pickAvatar(profile) || avatarUrl;
    } catch (error) {
      // Profile lookup is optional; keep the event's name/avatar fallback.
    }
  }

  return { requesterName: name, requesterAvatarUrl: avatarUrl };
}

module.exports = { getRequesterProfile };
