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
  if (!Users?.getData || !Users?.setData) return;
  const record = await Users.getData(String(uid));
  const data = record?.data && typeof record.data === "object"
    ? { ...record.data }
    : (record && typeof record === "object" ? { ...record } : {});
  const profile = data.noitu && typeof data.noitu === "object" ? { ...data.noitu } : {};
  profile.points = Math.max(0, Number(profile.points) || 0) + 1;
  profile.moves = Math.max(0, Number(profile.moves) || 0) + 1;
  data.noitu = profile;
  await Users.setData(String(uid), data);
}

module.exports.run = async function ({ api, event, Users, isSelf }) {
  if (isSelf) return;
  const content = String(event?.data?.content || "").trim();
  const prefix = global.config?.prefix || "/";
  if (!content || content.startsWith(prefix)) return;
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
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
  await addPoint(Users, uid);
  const nextName = result.nextPlayer?.name || "người chơi";
  return send(api, event,
    "✅ " + result.phrase.display + " — nối thành công! +1 điểm\n" +
    "🔗 Cụm tiếp theo phải bắt đầu bằng tiếng " + result.phrase.last + ".\n" +
    "🎯 Đến lượt: " + nextName + "."
  );
};
module.exports._test = { addPoint };
