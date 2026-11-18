// ===== EVENT MỚI: RANK — tự cộng EXP theo hoạt động chat =====
// Mỗi tin nhắn (không phải lệnh, đủ dài) được cộng EXP. Đủ EXP thì lên level
// và bot thông báo bằng thẻ canvas. Mỗi người 30s mới được cộng 1 lần.
// Bật/tắt trong nhóm: /events rank on|off
const { Reactions } = require("zalo-client");

const EXP_PER_MESSAGE = 5;      // cơ bản
const EXP_PER_CHAR = 0.5;       // cộng thêm theo độ dài tin
const EXP_COOLDOWN_MS = 30000;  // 30s mới cộng 1 lần cho mỗi người
const BASE_LEVEL_EXP = 100;     // level 1 → 2 cần 100 EXP, mỗi level +50%

module.exports.config = {
  name: "rank",
  event_type: ["message"],
  version: "1.0.0",
  author: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
  description: "Tự cộng EXP và thông báo lên level khi chat",
  category: "Sự kiện",
  usage: "events rank on|off",
  cooldowns: 0
};

function expForLevel(level) {
  return Math.round(BASE_LEVEL_EXP * Math.pow(level, 1.4));
}

module.exports.run = async function ({ api, event, Threads, isSelf }) {
  if (isSelf) return;

  const { data, threadId } = event;
  const content = String(data?.content || "").trim();
  if (!content || content.length < 3) return;

  // Bỏ qua lệnh (bắt đầu bằng prefix)
  const prefix = global.config.prefix;
  if (prefix && content.startsWith(prefix)) return;

  // Chỉ chạy khi nhóm đã bật
  // The listener's group snapshot is already hot for normal messages.
  // Do not await a storage read when no cached rank setting is enabled.
  let record = null;
  try { record = Threads.getCachedData?.(String(threadId)) || null; } catch {}
  if (!record) record = await Threads.getData(threadId);
  const thread = { ...(record?.data || record || {}) };
  if (!thread.event_rank) return;

  const uid = String(data.uidFrom || "");
  if (!uid) return;

  // Cooldown theo người (tránh spam EXP)
  const key = `rankExp_${uid}`;
  const lastExp = Number(thread[key]) || 0;
  const now = Date.now();
  if (now - lastExp < EXP_COOLDOWN_MS) return;

  const gained = Math.min(Math.round(EXP_PER_MESSAGE + content.length * EXP_PER_CHAR), 30);
  const level = Number(thread[`rankLv_${uid}`]) || 1;
  const exp = (Number(thread[`rankXp_${uid}`]) || 0) + gained;

  const need = expForLevel(level);
  if (exp >= need) {
    // Lên level: reset EXP, thông báo bằng thẻ
    thread[`rankLv_${uid}`] = level + 1;
    thread[`rankXp_${uid}`] = exp - need;
    thread[key] = now;
    await Threads.setData(threadId, thread);

    try {
      await api.sendMessage({
        mentions: [{ pos: 0, uid, len: 2 }],
        msg: ""
      }, threadId, event.type);
      // Thông báo level up bằng thẻ canvas
      const { renderVipCard } = require("../../core/canvas/vip");
      const fs = require("fs");
      const card = await renderVipCard({
        theme: "success",
        icon: "🎉",
        title: "Level up!",
        subtitle: `Chúc mừng @. đã lên level ${level + 1}`,
        rows: [
          { label: "Level mới", lines: [`🏆 Level ${level + 1}`, `✨ EXP: ${exp - need}/${expForLevel(level + 1)}`] },
          { label: "Cách lên level", lines: ["💬 Chat trong nhóm để nhận EXP (30s/lần)"] }
        ],
        footer: "ᴶᴼᴴᴺ ᵀᴿᴬᴺ",
        });
      await api.sendMessage({
        msg: "",
        attachments: card,
        mentions: [{ pos: 0, uid, len: 2 }]
      }, threadId, event.type);
      fs.unlinkSync(card);
    } catch (error) {
      console.error("Lỗi thông báo level up:", error.message);
    }
    return;
  }

  thread[`rankXp_${uid}`] = exp;
  thread[key] = now;
  await Threads.setData(threadId, thread);
};
