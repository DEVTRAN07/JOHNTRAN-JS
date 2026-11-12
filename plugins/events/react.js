// ===== AUTO REACTION — phản ứng tự nhiên cho tin nhắn thành viên =====
// Bật/tắt theo từng nhóm: /events react on|off
// Chỉ xử lý tin nhắn thường trong nhóm; bỏ qua bot, lệnh và tin quá ngắn.
// Cooldown lưu trong RAM để không ghi database ở mỗi lần thả reaction.

const { Reactions, ThreadType } = require("zalo-client");

const COOLDOWN_MS = 10000;
const MAX_COOLDOWN_ENTRIES = 5000;
const cooldowns = new Map();

const POOLS = {
  love: [Reactions.HEART, Reactions.KISS, Reactions.ROSE],
  funny: [Reactions.HAHA, Reactions.BIG_SMILE],
  wow: [Reactions.WOW, Reactions.COOL],
  agree: [Reactions.LIKE, Reactions.OK, Reactions.HANDCLAP],
  thanks: [Reactions.THANKS, Reactions.PRAY],
  casual: [Reactions.LIKE, Reactions.HAHA, Reactions.WOW, Reactions.OK, Reactions.COOL, Reactions.BIG_SMILE, Reactions.PEACE]
};

const KEYWORDS = [
  { pool: "love", words: /\b(yêu|iu|thương|love|❤️|💕|🥰|😘)\b/i },
  { pool: "funny", words: /(haha|hihi|ㅋㅋ|😂|🤣|buồn cười|mắc cười)/i },
  { pool: "wow", words: /(wow|ôi|trời ơi|ghê|đỉnh|khủng|😮|🤯)/i },
  { pool: "thanks", words: /(cảm ơn|cam on|thanks|thank you|tks|🙏)/i },
  { pool: "agree", words: /(đúng|chuẩn|ok|oke|đồng ý|chính xác|👍|👏)/i }
];

function pickReaction(content) {
  const matched = KEYWORDS.find((item) => item.words.test(content));
  const source = (matched ? POOLS[matched.pool] : POOLS.casual).filter(Boolean);
  if (!source.length) return null;
  return source[Math.floor(Math.random() * source.length)];
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
  version: "2.0.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Reaction tự động thông minh cho tin nhắn thành viên",
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

  // Chỉ đọc trạng thái nhóm; không ghi Threads cho từng reaction.
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

  // Đặt khóa trước await để chặn nhiều tin nhắn đồng thời của cùng người.
  cooldowns.set(key, now);
  pruneCooldowns(now);

  try {
    await api.addReaction(reaction, {
      data: { msgId, cliMsgId },
      threadId,
      type: ThreadType.Group
    });
  } catch {
    // Tin đã cũ hoặc Zalo từ chối reaction: bỏ qua, không làm gián đoạn listener.
    if (cooldowns.get(key) === now) cooldowns.delete(key);
  }
};
