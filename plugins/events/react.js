// ===== AUTO YES / NO — gửi chữ bằng cách reply trực tiếp tin nhắn =====
// Không dùng reaction emoji. Bot trả lời trích dẫn "YES" hoặc "NO".
// Bật/tắt theo từng nhóm: /events react on|off

const { ThreadType } = require("zalo-client");

const COOLDOWN_MS = 10000;
const MAX_COOLDOWN_ENTRIES = 5000;
const cooldowns = new Map();

const NEGATIVE_PATTERN = /(?:^|[^\\p{L}])(không|ko|kh|khum|chưa|chẳng|đừng|thôi|sai|no|nope|never|disagree)(?=$|[^\\p{L}])/iu;

function pickAnswer(content) {
  return NEGATIVE_PATTERN.test(content) ? "NO" : "YES";
}

function pruneCooldowns(now) {
  if (cooldowns.size < MAX_COOLDOWN_ENTRIES) return;
  for (const [key, at] of cooldowns) {
    if (now - at >= COOLDOWN_MS) cooldowns.delete(key);
    if (cooldowns.size < MAX_COOLDOWN_ENTRIES * 0.8) break;
  }
}

module.exports.config = {
  name: "react",
  event_type: ["message"],
  version: "4.0.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tự động reply chữ YES / NO vào tin nhắn thành viên",
  category: "Sự kiện",
  usage: "events react on|off",
  cooldowns: 0
};

module.exports.run = async function ({ api, event, Threads, isSelf }) {
  if (isSelf || event.type !== ThreadType.Group) return;

  const { data, threadId } = event;
  const content = String(data?.content || "").trim();
  if (content.length < 2) return;

  const prefix = global.config?.prefix;
  if (prefix && content.startsWith(prefix)) return;

  const thread = (await Threads.getData(threadId)).data || {};
  if (!thread.event_react) return;

  const uid = String(data.uidFrom || "");
  if (!uid || !data.msgId || !data.cliMsgId || typeof api?.sendMessage !== "function") return;

  const now = Date.now();
  const key = String(threadId) + ":" + uid;
  const last = cooldowns.get(key) || 0;
  if (now - last < COOLDOWN_MS) return;

  // Zalo yêu cầu đầy đủ metadata của tin gốc để gửi quote.
  const quote = {
    content: data.content,
    msgType: data.msgType,
    propertyExt: data.propertyExt,
    uidFrom: data.uidFrom,
    msgId: data.msgId,
    cliMsgId: data.cliMsgId,
    ts: data.ts,
    ttl: data.ttl
  };
  if (!quote.msgType || quote.ts === undefined) return;

  cooldowns.set(key, now);
  pruneCooldowns(now);

  try {
    await api.sendMessage(
      { msg: pickAnswer(content), quote },
      threadId,
      ThreadType.Group
    );
  } catch {
    if (cooldowns.get(key) === now) cooldowns.delete(key);
  }
};
