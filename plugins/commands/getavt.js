// /getavt — Lấy ảnh đại diện người dùng (theo mẫu Kenne400k/filebotha-leak)
// Tham khảo modules/commands/Getavt.js — cùng cấu trúc lệnh:
//   /getavt                      → HDSD
//   /getavt id <uid>             → lấy avatar theo UID
//   /getavt link <link>          → lấy theo link profile
//   /getavt user                 → avatar của chính mình
//   /getavt user @mentions       → avatar người được tag
//   /getavt <uid> hoặc /getavt @tag → lấy nhanh (bổ sung)
// Viết lại cho Zalo API (không dùng facebook graph/token).
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fetchProfile } = require("../../core/zaloProfile");

module.exports.config = {
  name: "getavt",
  aliases: ["avt", "avatar"],
  version: "4.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Lấy ảnh đại diện người dùng",
  category: "Tiện ích",
  usage: "getavt id [uid] | getavt link [link] | getavt user",
  cooldowns: 3,
  dependencies: {}
};

const HD = `=== 『 GET-AVATAR 』 ===

• getavt id [uid] → lấy ảnh theo UID người muốn lấy
• getavt link [link] → lấy theo link profile
• getavt user → lấy avatar của chính người dùng lệnh
• getavt user [@mentions] → lấy avatar người vừa tag

• HDSD => không lấy được avatar khi người đó chưa đặt ảnh hoặc chặn bot`;

// Tải ảnh về file tạm rồi gửi (giống cách repo: lưu cache → gửi → xoá)
async function sendAvatarFromUrl(api, threadId, type, url) {
  const { loadImg } = require("../../core/canvas/profileCard"); // lazy — canvas+jimp ~1.6s
  const img = await loadImg(url);
  if (!img) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt_avt_"));
  const filePath = path.join(tmpDir, "avatar.png");
  try {
    const canvas = require("canvas").createCanvas(img.width, img.height);
    canvas.getContext("2d").drawImage(img, 0, 0);
    fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    await api.sendMessage({ msg: "", attachments: [filePath], ttlKind: "media" }, threadId, type);
    return true;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
}

// Lấy avatar của 1 uid → gửi
async function getAvatar(api, threadId, type, uid) {
  const { user } = await fetchProfile(api, uid);
  if (!user) {
    await api.sendMessage({ msg: "❌ Người dùng không tồn tại.", plain: true, ttl: 60000 }, threadId, type);
    return;
  }
  const avatar = String(user.avatar || "").trim();
  if (!/^https?:\/\//i.test(avatar)) {
    await api.sendMessage({
      msg: `⚠️ Không lấy được ảnh đại diện của ${user.displayName || uid}.\n(Zalo trả về đường dẫn mặc định "${avatar || "trống"}" — người này chưa đặt ảnh hoặc chặn bot.)`,
      plain: true,
      ttl: 60000
    }, threadId, type);
    return;
  }
  const ok = await sendAvatarFromUrl(api, threadId, type, avatar).catch(() => null);
  if (!ok) {
    await api.sendMessage({ msg: "❌ Không thể lấy ảnh người dùng.", plain: true, ttl: 60000 }, threadId, type);
  }
}

module.exports.run = async function ({ api, event, args }) {
  const { threadId, type, data } = event;
  const firstTag = (event.mentions && event.mentions[0]?.uid) || require("../../core/mentions").firstMention(data);
  const sub = (args[0] || "").toLowerCase();

  // ===== KHÔNG THAM SỐ → HDSD (như repo) =====
  if (!args[0]) {
    return api.sendMessage({ msg: HD, plain: true, ttl: 120000 }, threadId, type);
  }

  // ===== ID <uid> =====
  if (sub === "id") {
    const uid = args[1];
    if (!uid || !/^\d{6,}$/.test(uid)) {
      return api.sendMessage({ msg: "⚠️ Vui lòng nhập uid cần get avatar.", plain: true, ttl: 60000 }, threadId, type);
    }
    return getAvatar(api, threadId, type, uid);
  }

  // ===== LINK <link> =====
  if (sub === "link") {
    const link = args.slice(1).join(" ");
    if (!link) {
      return api.sendMessage({ msg: "⚠️ Vui lòng nhập link cần get avatar.", plain: true, ttl: 60000 }, threadId, type);
    }
    // Zalo không có link profile công khai kiểu FB → lấy uid nếu link có dạng zalo.me/xxxx
    const m = link.match(/zalo\.me\/(\d{6,})/) || link.match(/(\d{6,})/);
    if (!m) {
      return api.sendMessage({ msg: "❌ Không đọc được uid từ link này (Zalo cần uid, không lấy được từ link FB).", plain: true, ttl: 60000 }, threadId, type);
    }
    return getAvatar(api, threadId, type, m[1]);
  }

  // ===== USER [@tag] =====
  if (sub === "user") {
    // /getavt user @tag → avatar người được tag
    if (firstTag) return getAvatar(api, threadId, type, firstTag);
    // /getavt user <uid> → avatar theo uid
    if (args[1] && /^\d{6,}$/.test(args[1])) {
      return getAvatar(api, threadId, type, args[1]);
    }
    return getAvatar(api, threadId, type, String(data.uidFrom));
  }

  // ===== GÕ NHANH: /getavt <uid> hoặc /getavt @tag =====
  if (/^\d{6,}$/.test(sub)) return getAvatar(api, threadId, type, sub);
  if (firstTag) return getAvatar(api, threadId, type, firstTag);

  return api.sendMessage({ msg: "❌ Sai lệnh. Gõ /getavt để xem hướng dẫn.", plain: true, ttl: 60000 }, threadId, type);
};
