// /card — Thẻ hồ sơ theo layout Kenne400k (avatar tròn + thông tin bên phải)
// Tham khảo: Kenne400k/filebotha-leak (modules/commands/card.js)
const http = require("../../core/http");
const { fetchProfile } = require("../../core/zaloProfile");
const { mediaCache } = require("../../core/mediaCache");
const crypto = require("crypto");

module.exports.config = {
  name: "card",
  aliases: ["cardinfo", "userinfo", "info"],
  version: "3.2.0",
  role: 0,
  author: "J^H^N T^R^A^N",
  description: "Thẻ hồ sơ người dùng (layout Kenne400k)",
  category: "Tiện ích",
  usage: "card (reply) | card <uid> | card box",
  cooldowns: 5,
  dependencies: {}
};

function genderText(g) {
  const n = Number(g);
  if (n === 1) return "Nam";
  if (n === 2) return "Nữ";
  return "Không công khai";
}

function dobText(dob, sdob) {
  if (sdob) return String(sdob);
  if (!dob) return "không công khai";
  const d = new Date(Number(dob) * 1000);
  if (Number.isNaN(d.getTime())) return "không công khai";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function urlCacheKey(url) {
  return crypto.createHash("sha256").update(String(url)).digest("hex");
}

async function getCachedAvatar(avatarUrl) {
  const key = urlCacheKey(avatarUrl);
  const cached = await mediaCache.get(key);
  if (cached && cached.buffer) return cached.buffer;
  return null;
}

async function cacheAvatar(avatarUrl, buffer) {
  const key = urlCacheKey(avatarUrl);
  const result = await mediaCache.upload(buffer, "image", { sourceUrl: avatarUrl });
  return result.url;
}

module.exports.run = async function ({ api, event, args, reply }) {
  const card = require("../../core/canvas/profileCard"); // lazy — canvas+jimp ~1.6s
  const { threadId, type, data } = event;

  await api.sendMessage({ msg: "⏳ Đang tạo thẻ...", plain: true }, threadId, type);

  // ---- chọn uid: reply → uid → tag → chính mình ----
  let uid = null;
  const quote = data?.quote;
  const mentioned = (event.mentions && event.mentions[0]?.uid) || require("../../core/mentions").firstMention(data);
  if (mentioned) uid = String(mentioned);
  else if (args[0] && /^\d{6,}$/.test(args[0])) uid = args[0];
  else if (quote?.uidFrom) uid = String(quote.uidFrom);
  else uid = String(data.uidFrom);

  const { user } = await fetchProfile(api, uid);
  if (!user) return reply.error(`Không đọc được hồ sơ của ${uid}.`);

  // ---- avatar (cache bằng mediaCache) ----
  let avatarBuffer = null;
  const avatar = String(user.avatar || "").trim();
  if (/^https?:\/\//i.test(avatar)) {
    try {
      // 1) kiểm tra cache trước
      avatarBuffer = await getCachedAvatar(avatar);
      // 2) nếu chưa có cache → tải về và upload lên mediaCache
      if (!avatarBuffer) {
        const { buffer, contentType } = await http.getBuffer(avatar, { timeout: 20000 });
        if (buffer?.length && (!contentType || contentType.toLowerCase().startsWith("image/"))) {
          avatarBuffer = buffer;
          await cacheAvatar(avatar, buffer).catch(() => {}); // không làm fail nếu upload cache lỗi
        }
      }
    } catch { /* thiếu ảnh vẫn tạo thẻ */ }
  }

  // ---- render + gửi ----
  let cardPath = null;
  try {
    cardPath = await card.render({
      name: String(user.displayName || user.zaloName || "—"),
      avatarBuffer,
      rows: [
        ["» Sinh nhật", dobText(user.dob, user.sdob)],
        ["» Giới tính", genderText(user.gender)],
        ["» Bạn bè", Number(user.isFr) === 1 ? "Có" : "Chưa kết bạn"],
        ["» Trạng thái", user.status ? String(user.status).slice(0, 22) : "Không có"],
        ["» UID", uid]
      ],
      link: user.username ? `@${user.username}` : uid
    });
    await api.sendMessage({ msg: "", attachments: [cardPath], ttlKind: "card" }, threadId, type);
  } catch (error) {
    console.error("card:", error.message);
    return reply.error(`Tạo thẻ thất bại: ${error.message}`);
  }
};
