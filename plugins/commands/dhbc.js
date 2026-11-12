"use strict";

const fs = require("fs");
const path = require("path");
const game = require("../../core/runtime/services/games/dhbcService");
const { renderQuestion } = require("../../core/canvas/dhbc");

module.exports.config = {
  name: "dhbc", aliases: [], version: "1.0.0", role: 0,
  author: "Wuang", description: "Game Đuổi Hình Bắt Chữ",
  category: "Game", usage: "dhbc [go|join|leave|stop|hint|pass|bxh|solve|on|off|reset]",
  cooldowns: 0, dependencies: {}
};

const isAdmin = (uid) => global.users?.admin?.map(String).includes(String(uid));
const enabled = () => game.isEnabled();
const setEnabled = (value) => game.setEnabled(value);
const unwrap = (record) => record?.data && typeof record.data === "object" ? record.data : (record || {});
async function readUser(Users, uid) { return unwrap(await Users.getData(String(uid))); }
async function writeUser(Users, uid, data) { await Users.setData(String(uid), data); }
async function getName(api, event) {
  const data = event?.data || {};
  let name = String(data.dName || data.name || "Player");
  try {
    const id = String(data.uidFrom || "");
    const response = id && await api.getUserInfo?.(id, 240);
    const profiles = response?.changed_profiles || response?.changedProfiles || {};
    const profile = profiles[id] || profiles[`${id}_0`] || Object.values(profiles)[0] || {};
    name = String(profile.displayName || profile.zaloName || profile.username || name);
  } catch {}
  return name;
}
async function send(api, event, msg, attachment) {
  try {
    return await api.sendMessage({ msg, ...(attachment ? { attachments: [attachment] } : {}) }, event.threadId, event.type);
  } finally {
    if (attachment) {
      const timer = setTimeout(() => { try { fs.rmSync(attachment, { force: true }); } catch {} }, 60000);
      timer.unref?.();
    }
  }
}
async function sendQuestion(api, event, session, prefix) {
  const image = await renderQuestion(session.question, session.questionNumber);
  const mode = session.players.size > 1 ? "Nhóm" : "Đơn";
  return send(api, event,
    `🧩 CÂU #${session.questionNumber} • ${mode}\n👥 Người chơi: ${session.players.size}\n💡 Dùng ${prefix}dhbc hint để mở gợi ý (tốn ⭐).\n⏭️ Gõ pass để bỏ qua câu này.`,
    image);
}
async function saveWin(Users, uid) {
  const data = await readUser(Users, uid);
  const profile = data.dhbc && typeof data.dhbc === "object" ? data.dhbc : {};
  const now = Date.now();
  profile.points = Math.max(0, Number(profile.points) || 0) + 1;
  profile.stars = Math.max(0, Number(profile.stars) || 0) + 1;
  profile.correct = Math.max(0, Number(profile.correct) || 0) + 1;
  profile.history = Array.isArray(profile.history) ? profile.history : [];
  profile.history.push({ at: now, points: 1 });
  if (profile.history.length > 500) profile.history = profile.history.slice(-500);
  data.dhbc = profile;
  await writeUser(Users, uid, data);
  return profile;
}
async function leaderboard(Users, monthOnly = false) {
  const month = new Date().toISOString().slice(0, 7);
  const rows = Users.getAll().map((row) => {
    const profile = row?.data?.dhbc || {};
    const history = Array.isArray(profile.history) ? profile.history : [];
    const monthly = history.filter((item) => new Date(Number(item.at)).toISOString().slice(0, 7) === month)
      .reduce((sum, item) => sum + (Number(item.points) || 0), 0);
    return { uid: String(row.userId), points: monthOnly ? monthly : Number(profile.points) || 0, stars: Number(profile.stars) || 0 };
  }).filter((row) => row.points > 0).sort((a, b) => b.points - a.points).slice(0, 10);
  return rows;
}
function help(prefix) {
  return `🧩 GAME ĐUỔI HÌNH BẮT CHỮ [${enabled() ? "BẬT" : "TẮT"}]\n\n🕹️ CÁCH CHƠI:\n• ${prefix}dhbc go — Bắt đầu ván mới (+1 điểm, +1⭐ mỗi câu đúng)\n• join dhbc / join — Tham gia ván đang diễn ra\n• leave — Rời ván • stop — Dừng ván (chủ ván/Admin)\n• hint — Mở 1 chữ (1⭐ đơn, 2⭐ nhóm)\n• pass — Bỏ qua câu hỏi\n\n🏆 ${prefix}dhbc bxh [all|tháng]\n👑 ADMIN: ${prefix}dhbc solve [nhóm] | on | off | reset [all|history]\n\n👉 Gõ ${prefix}dhbc go để bắt đầu!`;
}

module.exports.run = async function ({ args = [], api, event, Users }) {
  const uid = String(event?.data?.uidFrom || "");
  if (!uid) return;
  const action = String(args[0] || "help").toLowerCase();
  const prefix = global.config?.prefix || "!";
  if (action === "help") return send(api, event, help(prefix));
  if (["on", "off", "reset", "solve"].includes(action) && !isAdmin(uid)) {
    return send(api, event, "⛔ Chỉ Admin mới được dùng thao tác này.");
  }
  if (!enabled() && !["on", "off"].includes(action)) return send(api, event, "⛔ DHBC hiện đang tắt.");
  const threadId = String(event.threadId);
  if (action === "on" || action === "off") {
    setEnabled(action === "on");
    return send(api, event, `🧩 DHBC đã ${action === "on" ? "BẬT" : "TẮT"}.`);
  }
  if (action === "go" || action === "start") {
    const result = game.start(threadId, uid, await getName(api, event));
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván DHBC. Gõ join để tham gia.");
    return sendQuestion(api, event, result.session, prefix);
  }
  if (action === "join") {
    const result = game.join(threadId, uid, await getName(api, event));
    return send(api, event, result.ok ? `🚪 Đã tham gia! Hiện có ${result.count} người chơi.` : "⚠️ Chưa có ván nào. Gõ dhbc go để bắt đầu.");
  }
  if (action === "leave") {
    const result = game.leave(threadId, uid);
    return send(api, event, result.ok ? "👋 Bạn đã rời ván." : "⚠️ Bạn chưa tham gia ván này.");
  }
  if (action === "stop") {
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Không có ván nào đang chạy.");
    if (session.ownerId !== uid && !isAdmin(uid)) return send(api, event, "⛔ Chỉ chủ ván hoặc Admin mới được dừng.");
    game.stop(threadId);
    return send(api, event, "🛑 Ván DHBC đã dừng.");
  }
  if (action === "hint") {
    const session = game.get(threadId);
    if (!session?.players.has(uid)) return send(api, event, "⚠️ Bạn chưa tham gia ván. Gõ join để tham gia.");
    const data = await readUser(Users, uid), profile = data.dhbc || {};
    const cost = session.players.size > 1 ? 2 : 1;
    const stars = Math.max(0, Number(profile.stars) || 0);
    if (stars < cost) return send(api, event, `⭐ Bạn cần ${cost}⭐ để dùng gợi ý. Hiện có ${stars}⭐.`);
    profile.stars = stars - cost; data.dhbc = profile; await writeUser(Users, uid, data);
    return send(api, event, `💡 Gợi ý: ${game.revealHint(threadId)}\n⭐ Đã dùng ${cost}⭐.`);
  }
  if (action === "pass") {
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Không có câu hỏi đang diễn ra.");
    const answer = session.question.answer;
    game.advance(threadId);
    await send(api, event, `⏭️ Đáp án là: ${answer}`);
    return sendQuestion(api, event, game.get(threadId), prefix);
  }
  if (action === "bxh" || action === "rank") {
    const monthOnly = args.some((arg) => ["thang", "tháng", "month"].includes(String(arg).toLowerCase()));
    const rows = await leaderboard(Users, monthOnly);
    if (!rows.length) return send(api, event, "🏆 Chưa có dữ liệu xếp hạng.");
    const lines = await Promise.all(rows.map(async (row, index) => {
      let name = row.uid;
      try {
        const record = await api.getUserInfo?.(row.uid, 240);
        const profiles = record?.changed_profiles || record?.changedProfiles || {};
        const user = profiles[row.uid] || profiles[`${row.uid}_0`] || Object.values(profiles)[0] || {};
        name = user.displayName || user.zaloName || name;
      } catch {}
      return `${index + 1}. ${name} — ${row.points} điểm`;
    }));
    return send(api, event, `🏆 BẢNG XẾP HẠNG DHBC ${monthOnly ? "THÁNG NÀY" : "TOÀN THỜI GIAN"}\n${lines.join("\n")}`);
  }
  if (action === "solve") {
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Không có ván nào đang chạy.");
    const answer = session.question.answer;
    game.advance(threadId);
    await send(api, event, `👑 Admin giải đáp: ${answer}`);
    return sendQuestion(api, event, game.get(threadId), prefix);
  }
  if (action === "reset") {
    const scope = String(args[1] || "all").toLowerCase();
    if (!["all", "history"].includes(scope)) return send(api, event, "Dùng: dhbc reset all|history");
    for (const row of Users.getAll()) {
      const data = { ...(row.data || {}) }, profile = { ...(data.dhbc || {}) };
      if (scope === "all") {
        profile.points = 0; profile.stars = 0; profile.correct = 0; profile.history = [];
      } else profile.history = [];
      data.dhbc = profile;
      await writeUser(Users, row.userId, data);
    }
    return send(api, event, `♻️ Đã reset DHBC: ${scope}.`);
  }
  return send(api, event, help(prefix));
};
module.exports._test = { leaderboard, normalizeAnswer: require("../../core/games/dhbcEngine").normalizeAnswer };
