// ===== AUTO REACTION — chỉ dùng YES / NO =====
// YES = 👍 (LIKE), NO = biểu tượng Không (NO).
// Bật/tắt theo từng nhóm: /events react on|off

const { Reactions, ThreadType } = require("zalo-client");

const COOLDOWN_MS = 10000;
const MAX_COOLDOWN_ENTRIES = 5000;
const cooldowns = new Map();

const NEGATIVE_PATTERN = /\b(không|ko|kh|khum|chưa|chẳng|đừng|thôi|sai|không đúng|không được|no|nope|never|disagree|رفض)\b/i;

function pickReaction(content) {
  return NEGATIVE_PATTERN.test(content) ? Reactions.NO : Reactions.LIKE;
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
  version: "3.0.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Reaction tự động chỉ với YES / NO",
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
  const msgId = data?.msgId;
  const cliMsgId = data?.cliMsgId;
  if (!uid || !msgId || !cliMsgId || typeof api?.addReaction !== "function") return;

  const now = Date.now();
  const key = String(threadId) + ":" + uid;
  const last = cooldowns.get(key) || 0;
  if (now - last < COOLDOWN_MS) return;

  const reaction = pickReaction(content);
  if (!reaction) return;

  cooldowns.set(key, now);
  pruneCooldowns(now);

  try {
    await api.addReaction(reaction, {
      data: { msgId, cliMsgId },
      threadId,
      type: ThreadType.Group
    });
  } catch {
    if (cooldowns.get(key) === now) cooldowns.delete(key);
  }
};
