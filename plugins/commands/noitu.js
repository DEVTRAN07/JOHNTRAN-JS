"use strict";

const game = require("../../core/runtime/services/games/noituService");

module.exports.config = {
  name: "noitu",
  aliases: [],
  version: "1.0.0",
  role: 0,
  author: "Wuang",
  description: "Game nối từ theo lượt trong nhóm",
  category: "Game",
  usage: "noitu [start|join|leave|pass|stop|rank|help]",
  cooldowns: 0,
  dependencies: {}
};

const isAdmin = uid => (global.users?.admin || []).map(String).includes(String(uid));
async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}
function help(prefix) {
  return [
    "🔗 GAME NỐI TỪ", "",
    "🎮 CÁCH CHƠI",
    prefix + "noitu start — Tạo ván mới",
    prefix + "noitu join — Tham gia ván",
    prefix + "noitu leave — Rời ván",
    prefix + "noitu pass — Bỏ lượt",
    prefix + "noitu stop — Dừng ván (chủ ván/Admin)",
    prefix + "noitu rank — Bảng xếp hạng", "",
    "📌 Nối tiếng cuối của cụm trước với tiếng đầu của cụm sau.",
    "📌 Cụm từ gồm 2–4 tiếng, không được dùng lại cụm đã xuất hiện.",
    "📌 Người tạo ván đi trước; người khác dùng join để xếp lượt.", "",
    "👉 Gõ " + prefix + "noitu start để bắt đầu!"
  ].join("\n");
}
function currentPlayerLine(session) {
  const player = session?.players.get(session?.turnUid);
  return player ? "🎯 Lượt tiếp theo: " + player.name + "." : "";
}
async function leaderboard(Users) {
  if (!Users?.getAll) return [];
  return Users.getAll().map(row => ({
    uid: String(row.userId),
    points: Math.max(0, Number(row?.data?.noitu?.points) || 0)
  })).filter(row => row.points > 0).sort((a, b) => b.points - a.points).slice(0, 10);
}

module.exports.run = async function ({ args = [], api, event, Users }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  const prefix = global.config?.prefix || "/";
  if (!uid || !threadId) return;
  const action = String(args[0] || "help").toLowerCase();
  if (action === "help") return send(api, event, help(prefix));

  if (action === "start" || action === "go") {
    const name = String(event?.data?.dName || event?.data?.name || "Người chơi");
    const result = game.start(threadId, uid, name);
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Nối Từ. Gõ join để vào lượt.");
    return send(api, event, "🔗 ĐÃ BẮT ĐẦU GAME NỐI TỪ\n\n🧩 Từ mở màn: " +
      result.session.currentPhrase.display + "\n👥 Người chơi: 1\n👉 Chủ ván nhập cụm từ bắt đầu bằng tiếng cuối của từ mở màn." +
      "\n📌 Gõ " + prefix + "noitu join để những người khác tham gia.");
  }

  if (action === "join") {
    const result = game.join(threadId, uid, event?.data?.dName || event?.data?.name || "Người chơi");
    if (!result.ok) {
      const messages = {
        NO_GAME: "⚠️ Chưa có ván. Gõ " + prefix + "noitu start để tạo ván.",
        ALREADY_JOINED: "Bạn đã ở trong ván."
      };
      return send(api, event, messages[result.code] || "⚠️ Không thể tham gia ván.");
    }
    return send(api, event, "✅ " + result.player.name + " đã tham gia. Hiện có " +
      result.count + " người chơi.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "leave") {
    const result = game.leave(threadId, uid);
    if (!result.ok) return send(api, event, result.code === "NO_GAME" ? "⚠️ Chưa có ván đang chạy." : "⚠️ Bạn chưa tham gia ván.");
    if (result.empty) return send(api, event, "👋 Bạn đã rời ván. Ván chơi đã kết thúc vì không còn người chơi.");
    return send(api, event, "👋 Đã rời ván.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "pass") {
    const result = game.pass(threadId, uid);
    if (!result.ok) return send(api, event, result.code === "NOT_TURN" ? "⏳ Chưa đến lượt bạn." : "⚠️ Bạn chưa tham gia ván.");
    return send(api, event, "⏭️ Đã bỏ lượt.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "stop") {
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Không có ván nào đang chạy.");
    if (session.ownerId !== uid && !isAdmin(uid)) return send(api, event, "⛔ Chỉ chủ ván hoặc Admin mới được dừng.");
    game.stop(threadId);
    return send(api, event, "🛑 Đã dừng game Nối Từ.");
  }

  if (action === "rank" || action === "bxh") {
    const rows = await leaderboard(Users);
    if (!rows.length) return send(api, event, "🏆 Chưa có dữ liệu xếp hạng Nối Từ.");
    const lines = rows.map((row, index) => (index + 1) + ". UID " + row.uid + " — " + row.points + " điểm");
    return send(api, event, "🏆 BẢNG XẾP HẠNG NỐI TỪ\n" + lines.join("\n"));
  }
  return send(api, event, help(prefix));
};
module.exports._test = { help, leaderboard };
