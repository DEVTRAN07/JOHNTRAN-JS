"use strict";

const game = require("../../core/runtime/services/games/noituService");

module.exports.config = {
  name: "noitu",
  event_type: ["message"],
  version: "1.0.0",
  author: "Wuang",
  description: "Xử lý lượt trả lời cho game Nối Từ",
  category: "Game",
  usage: "gửi cụm từ đúng lượt để nối tiếp",
  cooldowns: 0,
  dependencies: {}
};

async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}
async function addPoint(Users, uid) {
  if (!Users?.getData || !Users?.setData) return false;
  try {
    const record = await Users.getData(String(uid));
    const data = record?.data && typeof record.data === "object"
      ? { ...record.data }
      : (record && typeof record === "object" ? { ...record } : {});
    const profile = data.noitu && typeof data.noitu === "object" ? { ...data.noitu } : {};
    const monthKey = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);

    profile.points = Math.max(0, Number(profile.points) || 0) + 1;
    profile.moves = Math.max(0, Number(profile.moves) || 0) + 1;
    profile.modes = { ...(profile.modes || {}) };
    profile.modes.classic = Math.max(0, Number(profile.modes.classic) || 0) + 1;
    profile.months = { ...(profile.months || {}) };
    profile.months[monthKey] = { ...(profile.months[monthKey] || {}) };
    profile.months[monthKey].classic = Math.max(0, Number(profile.months[monthKey].classic) || 0) + 1;
    profile.months[monthKey].all = Math.max(0, Number(profile.months[monthKey].all) || 0) + 1;

    data.noitu = profile;
    await Users.setData(String(uid), data);
    return true;
  } catch (error) {
    console.warn("[NOITU_EVENT_SCORE]", error?.message || error);
    return false;
  }
}

module.exports.run = async function ({ api, event, Users, isSelf }) {
  if (isSelf) return;
  const content = String(event?.data?.content || "").trim();
  const prefix = global.config?.prefix || "/";
  if (!content || content.startsWith(prefix)) return;
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  // One board game per group: Caro owns incoming numeric/quick-control messages while active.
  const caro = require("../../core/runtime/services/games/caroService");
  if (caro.isPlaying(threadId)) return;

  const session = game.get(threadId);
  if (!session || session.turnUid !== uid) return;

  const result = game.play(threadId, uid, content);
  if (!result.ok) {
    const messages = {
      INVALID_PHRASE: "⚠️ Hãy nhập cụm từ gồm 2–4 tiếng.",
      WRONG_LINK: "🔁 Chưa nối đúng. Cụm tiếp theo phải bắt đầu bằng tiếng " + result.expected + ".",
      DUPLICATE: "♻️ Cụm từ này đã được dùng trong ván, hãy chọn cụm khác."
    };
    if (messages[result.code]) return send(api, event, messages[result.code]);
    return;
  }
  const saved = await addPoint(Users, uid);
  const nextName = result.nextPlayer?.name || "người chơi";
  return send(api, event,
    "✅ " + result.phrase.display + " — nối thành công! +1 điểm\n" +
    "🔗 Cụm tiếp theo phải bắt đầu bằng tiếng " + result.phrase.last + ".\n" +
    "🎯 Đến lượt: " + nextName + "." +
    (saved ? "" : "\n⚠️ Nước đi vẫn được ghi nhận trong ván, nhưng chưa đồng bộ được điểm lên BXH.")
  );
};
module.exports._test = { addPoint };
