// /infofb — Thông tin người dùng Facebook (thẻ theo layout Kenne400k)
//   /infofb <username | uid | link>
// Dữ liệu lấy qua curl_cffi (trang công khai) — Node.js thuần bị Cloudflare
// chặn nên không lấy được. Không cần FB token.
const { getBuffer: queuedGetBuffer } = require("../../core/runtime/queuedHttp");
const { fetchSocial } = require("../../core/socialFetch");

module.exports.config = {
  name: "infofb",
  aliases: ["fbinfo", "fb"],
  version: "2.0.0",
  role: 0,
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Thông tin người dùng Facebook",
  category: "Tiện ích",
  usage: "infofb <username | uid | link>",
  cooldowns: 10,
  dependencies: {}
};

function shortNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function parseTarget(raw) {
  return String(raw || "").trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.|m\.|web\.|business\.)?facebook\.com\//, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/.*$/, "")
    .replace(/profile\.php\?id=/, "")
    .trim();
}

module.exports.run = async function ({ api, event, args, reply }) {
  const { threadId, type } = event;
  const card = require("../../core/canvas/profileCard"); // lazy — canvas+jimp ~1.6s

  const raw = args[0];
  if (!raw) {
    return reply.error(
      `Cách dùng:\n` +
      `${global.config.prefix}infofb <username> (vd: zuck)\n` +
      `${global.config.prefix}infofb <uid> (vd: 4)\n` +
      `${global.config.prefix}infofb <link facebook>`
    );
  }

  const target = parseTarget(raw);
  if (!target || target.length < 1) return reply.error(`Không đọc được target từ: ${raw}`);

  await api.sendMessage({ msg: "⏳ Đang lấy thông tin Facebook...", plain: true }, threadId, type);

  const { data: info, error, code } = await fetchSocial("facebook", target);
  if (!info) return reply.error(error || `Không lấy được hồ sơ ${target}`);

  // ---- avatar ----
  let avatarBuffer = null;
  if (info.avatar) {
    try {
      const { buffer } = await queuedGetBuffer(info.avatar, { timeout: 20000, retries: 1 });
      avatarBuffer = buffer;
    } catch { /* thiếu ảnh vẫn tạo thẻ */ }
  }

  let cardPath = null;
  try {
    cardPath = await card.render({
      name: String(info.name || target),
      avatarBuffer,
      rows: [
        ["» Người theo dõi", shortNum(info.followers)],
        ["» Lượt thích", shortNum(info.talking_about || info.fan_count)],
        ["» Giới tính", info.gender || "Không công khai"],
        ["» Sinh nhật", info.birthday || "Không công khai"],
        ["» Địa điểm", info.location?.name || "Không công khai"],
        ["» ID", info.fb_id || target]
      ],
      link: info.about ? String(info.about).slice(0, 46) : (info.category ? String(info.category).slice(0, 46) : (info.username ? `@${info.username}` : target))
    });
    await api.sendMessage({ msg: "", attachments: [cardPath], ttlKind: "card" }, threadId, type);
  } catch (error) {
    console.error("infofb:", error.message);
    return reply.error(`Tạo thẻ thất bại: ${error.message}`);
  }
};
