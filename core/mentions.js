// ===== @mention: rút uid người được tag từ mọi dạng dữ liệu Zalo =====
// Zalo gửi mentions ở nhiều shape khác nhau tùy loại tin:
//   - mảng [{ uid, pos, len, type }]
//   - object { "123": {...}, "456": {...} } (một số phiên bản)
//   - trong data.mentions hoặc data.quote.mentions
// Helper này chuẩn hoá về mảng uid (string, bỏ trùng, bỏ "0").
function extractMentions(data) {
  const uids = [];
  const push = (uid) => {
    const id = String(uid || "").trim();
    if (id && id !== "0" && /^\d{5,}$/.test(id) && !uids.includes(id)) uids.push(id);
  };

  const source = data?.mentions || data?.quote?.mentions;
  if (!source) return uids;

  if (Array.isArray(source)) {
    for (const m of source) push(m?.uid);
  } else if (typeof source === "object") {
    for (const [key, value] of Object.entries(source)) push(value?.uid || key);
  }
  return uids;
}

// Lấy uid đầu tiên được tag (null nếu không có)
function firstMention(data) {
  return extractMentions(data)[0] || null;
}

const PLAIN_GAME_ACTIONS = new Set(["join caro", "lose", "leave", "stop", "pass", "skip"]);

function buildRequesterMention(event) {
  if (event?.type !== 1) return null;

  const uid = String(event?.data?.uidFrom || "").trim();
  if (!uid) return null;

  const content = typeof event?.data?.content === "string"
    ? event.data.content.trim()
    : "";
  const prefix = String(global.config?.prefix || "/");
  const isCommand = Boolean(prefix && content.startsWith(prefix)) ||
    PLAIN_GAME_ACTIONS.has(content.toLocaleLowerCase("vi-VN"));
  if (!isCommand) return null;

  const rawName = String(event?.data?.dName || event?.data?.name || "Bạn");
  const name = rawName.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/^@+/, "").trim() || "Bạn";
  const label = "@" + name;
  return {
    text: label + "\n",
    mention: { pos: 0, uid, len: label.length }
  };
}

function withRequesterMention(event, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const requester = buildRequesterMention(event);
  if (!requester) return payload;

  const originalMessage = typeof payload.msg === "string" ? payload.msg : "";
  const existingMentions = Array.isArray(payload.mentions)
    ? payload.mentions.map(mention => ({
        ...mention,
        pos: (Number(mention?.pos) || 0) + requester.text.length
      }))
    : [];

  return {
    ...payload,
    msg: requester.text + originalMessage,
    mentions: [requester.mention, ...existingMentions]
  };
}

module.exports = { buildRequesterMention, withRequesterMention };

module.exports = { extractMentions, firstMention, buildRequesterMention, withRequesterMention };
