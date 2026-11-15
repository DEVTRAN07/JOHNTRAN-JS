// ===== LẤY HỒ SƠ ZALO CHUẨN (dùng cho getavt / cardzalo) =====
// getUserInfo của Zalo map uid thành "uid_0" trước khi gọi API, nên key trong
// changed_profiles/unchanged_profiles KHÔNG phải uid trơn mà bạn gửi vào.
// Helper này thử mọi khả năng để không bao giờ trả về null oan.
const AVATAR_LARGE = 240;

// Chọn đúng bản ghi user trong response (thử uid, uid_0, prefix, hoặc entry duy nhất)
function pickUser(info, uid) {
  if (!info) return null;
  const maps = [info.changed_profiles, info.unchanged_profiles];
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;

    // Zalo có phiên bản trả về MẢNG hồ sơ thay vì object key
    if (Array.isArray(map)) {
      const hit = map.find((u) => {
        const id = String(u?.userId ?? u?.uid ?? u?.id ?? "");
        return id === uid || id.startsWith(uid);
      });
      // Khớp được thì trả, KHÔNG đoán phần tử duy nhất (dễ trả nhầm người)
      if (hit) return hit;
      continue;
    }

    if (map[uid]) return map[uid];
    if (map[`${uid}_0`]) return map[`${uid}_0`];
    const keys = Object.keys(map);
    for (const key of keys) {
      if (key === uid || key.startsWith(`${uid}_`) || key.startsWith(uid)) return map[key];
    }
    if (keys.length === 1) return map[keys[0]];
  }
  return null;
}

/**
 * Lấy hồ sơ + avatar kích thước lớn.
 * @returns {Promise<{user: object|null, raw: object}>}
 */
async function fetchProfile(api, uid) {
  let raw;
  let usedAvatarSize = true;
  try {
    raw = await api.getUserInfo(String(uid), AVATAR_LARGE);
  } catch (error) {
    // Thử lại không kèm avatarSize (một số phiên bản không nhận tham số 2)
    usedAvatarSize = false;
    try {
      raw = await api.getUserInfo(String(uid));
    } catch (error2) {
      throw error;
    }
  }
  const user = pickUser(raw, String(uid));

  // getUserInfo on some Zalo builds has profile data but no usable avatar URL.
  // Ask the dedicated profile-avatar endpoint as a fallback; keep name and
  // other profile fields from getUserInfo unchanged.
  if (user && typeof api.getAvatarUrlProfile === "function") {
    const { pickAvatar, pickAvatarByUid } = require("./runtime/avatarUrl");
    if (!pickAvatar(user)) {
      try {
        const avatarResponse = await api.getAvatarUrlProfile(String(uid), AVATAR_LARGE);
        const avatarUrl = pickAvatarByUid(avatarResponse, String(uid)) || pickAvatar(avatarResponse);
        if (avatarUrl) user.avatar = avatarUrl;
      } catch {
        // Avatar is optional: preserve the profile and let the card draw initials.
      }
    }
  }

  // Không đọc được user → log nguyên văn shape để biết Zalo thật trả gì
  if (!user) {
    const cp = raw?.changed_profiles;
    const up = raw?.unchanged_profiles;
    const detail = [
      `avatarSize=${usedAvatarSize ? AVATAR_LARGE : "mặc định"}`,
      `keys=${Object.keys(raw || {}).join(",")}`,
      `changed_keys=${cp ? Object.keys(cp).join(",") : "không có"}`,
      `changed_isArr=${Array.isArray(cp)}`,
      `unchanged_keys=${up ? Object.keys(up).join(",") : "không có"}`
    ].join(" | ");
    console.error(`[zaloProfile] ${uid} KHÔNG tra được user: ${detail}`);
  }
  return { user, raw };
}

module.exports = { pickUser, fetchProfile, AVATAR_LARGE };
