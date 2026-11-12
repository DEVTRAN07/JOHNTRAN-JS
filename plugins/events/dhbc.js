"use strict";

const game = require("../../core/runtime/services/games/dhbcService");
const { renderQuestion } = require("../../core/canvas/dhbc");
const fs = require("fs");

module.exports.config = {
  name: "dhbc", event_type: ["message"], version: "1.0.0",
  author: "Wuang", description: "Nhận đáp án và thao tác nhanh cho game DHBC",
  category: "Game", usage: "join dhbc | join | leave | stop | hint | pass", cooldowns: 0
};

const unwrap = (record) => record?.data && typeof record.data === "object" ? record.data : (record || {});
async function send(api, event, msg, attachment) {
  try { return await api.sendMessage({ msg, ...(attachment ? { attachments: [attachment] } : {}) }, event.threadId, event.type); }
  finally {
    if (attachment) { const timer = setTimeout(() => { try { fs.rmSync(attachment, { force: true }); } catch {} }, 60000); timer.unref?.(); }
  }
}
async function sendQuestion(api, event, session) {
  const image = await renderQuestion(session.question, session.questionNumber);
  return send(api, event, `🧩 CÂU #${session.questionNumber} • ${session.players.size > 1 ? "Nhóm" : "Đơn"}\n💡 Dùng hint để mở chữ • pass để bỏ qua.`, image);
}
async function award(Users, uid) {
  const record = await Users.getData(String(uid)), data = unwrap(record), profile = { ...(data.dhbc || {}) };
  profile.points = (Number(profile.points) || 0) + 1;
  profile.stars = (Number(profile.stars) || 0) + 1;
  profile.correct = (Number(profile.correct) || 0) + 1;
  profile.history = Array.isArray(profile.history) ? profile.history : [];
  profile.history.push({ at: Date.now(), points: 1 });
  if (profile.history.length > 500) profile.history = profile.history.slice(-500);
  data.dhbc = profile;
  await Users.setData(String(uid), data);
}
module.exports.run = async function ({ api, event, Users, isSelf }) {
  if (isSelf || !game.isEnabled()) return;
  const content = String(event?.data?.content || "").trim();
  const prefix = global.config?.prefix || "!";
  if (!content || content.startsWith(prefix)) return;
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  const key = content.toLowerCase();
  const session = game.get(threadId);
  if (!session) return;
  if (key === "join" || key === "join dhbc") {
    const name = String(event?.data?.dName || event?.data?.name || "Player");
    const result = game.join(threadId, uid, name);
    if (result.ok) return send(api, event, `🚪 Đã tham gia DHBC! ${result.count} người chơi.`);
    return;
  }
  if (key === "leave") {
    const result = game.leave(threadId, uid);
    if (result.ok) return send(api, event, "👋 Bạn đã rời ván DHBC.");
    return;
  }
  if (key === "stop") {
    if (session.ownerId !== uid && !global.users?.admin?.map(String).includes(uid)) return;
    game.stop(threadId);
    return send(api, event, "🛑 Ván DHBC đã dừng.");
  }
  if (key === "hint") {
    if (!session.players.has(uid)) return;
    const record = await Users.getData(uid), data = unwrap(record), profile = { ...(data.dhbc || {}) };
    const cost = session.players.size > 1 ? 2 : 1;
    const stars = Number(profile.stars) || 0;
    if (stars < cost) return send(api, event, `⭐ Cần ${cost}⭐ để gợi ý. Bạn có ${stars}⭐.`);
    profile.stars = stars - cost; data.dhbc = profile; await Users.setData(uid, data);
    return send(api, event, `💡 ${game.revealHint(threadId)} • -${cost}⭐`);
  }
  if (key === "pass") {
    const answer = session.question.answer;
    game.advance(threadId);
    await send(api, event, `⏭️ Đáp án: ${answer}`);
    return sendQuestion(api, event, game.get(threadId));
  }
  if (!session.players.has(uid)) return;
  const result = game.answer(threadId, content);
  if (!result.correct) return;
  await award(Users, uid);
  await send(api, event, `🎉 Chính xác @${event?.data?.dName || event?.data?.name || "bạn"}! +1 điểm • +1⭐`);
  return sendQuestion(api, event, game.get(threadId));
};
