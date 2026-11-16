"use strict";

const game = require("../../core/runtime/services/games/noituService");
const fs = require("fs");
const { renderCanvas } = require("../../core/canvas/workerRender");
const ghepChu = require("../../core/runtime/services/games/ghepchuService");
const quickNoitu = require("../../core/runtime/services/games/noituQuickService");
const noituRoom = require("../../core/runtime/services/games/noituRoomService");
const noituBotAI = require("../../core/games/noituBotAI");
const noituEngine = require("../../core/games/noituEngine");
const defaultUsers = require("../../core/runtime/services/userService");
const defaultThreads = require("../../core/runtime/services/threadService");
const { getRequesterProfile } = require("../../core/runtime/requesterProfile");
const botVersion = require("../../package.json").version;
const ghepChuTimers = new Map();
const quickNoituTimers = new Map();

module.exports.config = {
  name: "noitu",
  aliases: ["nt"],
  version: "1.0.0",
  role: 0,
  author: "Wuang",
  description: "Game nối từ theo lượt trong nhóm",
  category: "Game",
  usage: "nt [go|gc|q|room|bxh|check|words|on|off|reset]",
  cooldowns: 0,
  dependencies: {}
};

const isAdmin = uid => (global.users?.admin || []).map(String).includes(String(uid));
async function send(api, event, msg) {
  return api.sendMessage({ msg }, event.threadId, event.type);
}

function clearQuickNoituTimer(threadId) {
  const timer = quickNoituTimers.get(String(threadId));
  if (timer) clearTimeout(timer);
  quickNoituTimers.delete(String(threadId));
}

async function finishQuickNoitu(api, event, session, caption = "⌛ Hết 60 giây!") {
  clearQuickNoituTimer(event.threadId);
  if (!session) return;
  return send(api, event, [
    caption,
    "🏁 KẾT THÚC NỐI TỪ TỐC ĐỘ",
    "👤 " + session.playerName,
    "⭐ Điểm: " + session.score,
    "✅ Đúng: " + session.correct + " · ❌ Sai: " + session.wrong
  ].join("\n"));
}

function scheduleQuickNoituExpiry(api, event, threadId) {
  clearQuickNoituTimer(threadId);
  const session = quickNoitu.get(threadId);
  if (!session || session.status !== "active") return;
  const delay = Math.max(20, quickNoitu.remainingMs(session));
  const timer = setTimeout(async () => {
    const current = quickNoitu.get(threadId);
    if (!current || current.status !== "active") return;
    if (quickNoitu.remainingMs(current) > 0) {
      scheduleQuickNoituExpiry(api, event, threadId);
      return;
    }
    await finishQuickNoitu(api, event, quickNoitu.finish(threadId));
  }, delay);
  timer.unref?.();
  quickNoituTimers.set(String(threadId), timer);
}

async function startNoituRoom({ api, event }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  const caro = require("../../core/runtime/services/games/caroService");
  if (game.get(threadId)?.status === "active" || ghepChu.get(threadId)?.status === "active" ||
      quickNoitu.get(threadId)?.status === "active" || caro.get(threadId)) {
    return send(api, event, "⚠️ Nhóm đang có game khác. Hãy kết thúc game hiện tại trước khi mở phòng Nối Từ.");
  }
  const result = noituRoom.create(threadId, uid, event?.data?.dName || event?.data?.name || "Người chơi");
  if (!result.ok) {
    if (result.code === "ROOM_EXISTS") {
      return send(api, event, "⚠️ Phòng đã tồn tại: " + result.room.code + " · " +
        result.room.players.length + "/" + result.room.maxPlayers + " người. Gõ /nt join " + result.room.code + " để tham gia.");
    }
    return send(api, event, "⚠️ Không thể tạo phòng Nối Từ.");
  }
  return send(api, event,
    "🏠 PHÒNG NỐI TỪ PvP ĐÃ TẠO\n" +
    "🔑 Mã phòng: " + result.room.code + "\n" +
    "👑 Chủ phòng: " + result.room.ownerName + "\n" +
    "👥 Người chơi: 1/" + result.room.maxPlayers + "\n\n" +
    "👉 Thành viên nhập /nt join " + result.room.code + " để tham gia.\n" +
    "▶️ Chủ phòng nhập /nt start khi có ít nhất 2 người."
  );
}

async function startNoituRoomGame({ api, event }) {
  const result = noituRoom.start(event.threadId, event?.data?.uidFrom);
  if (!result.ok) {
    const messages = {
      NO_ROOM: "⚠️ Chưa có phòng. Gõ /nt room để tạo phòng.",
      NOT_OWNER: "⛔ Chỉ chủ phòng mới được bắt đầu.",
      NEED_TWO_PLAYERS: "👥 Cần ít nhất 2 người chơi mới bắt đầu được."
    };
    return send(api, event, messages[result.code] || "⚠️ Phòng không thể bắt đầu.");
  }
  const gameSession = result.game;
  const names = [...gameSession.players.values()].map((player, index) => (index + 1) + ". " + player.name).join("\n");
  return send(api, event,
    "⚔️ NỐI TỪ PvP — BẮT ĐẦU!\n" +
    "🔑 Phòng: " + result.room.code + "\n" +
    "👥 Người chơi:\n" + names + "\n\n" +
    "🧩 Từ mở màn: " + gameSession.currentPhrase.display + "\n" +
    "👉 Trả lời trực tiếp theo lượt, mỗi cụm gồm 2–4 tiếng.\n" +
    currentPlayerLine(gameSession)
  );
}

async function handleNoituRoomText({ api, event, eventType, isSelf = false, Users }) {
  if ((eventType && eventType !== "message") || ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true)) return false;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return false;
  const room = noituRoom.get(threadId);
  if (!room || room.status !== "active" || !room.players?.has(uid)) return false;
  const content = getPlainMessage(event);
  if (!content) return false;
  const prefix = String(global.config?.prefix || "/");
  if (content.startsWith(prefix)) return false;

  const action = content.toLocaleLowerCase("vi-VN");
  if (["stop", "cancel", "thua", "lose"].includes(action)) {
    if (room.ownerId !== uid && !isAdmin(uid)) {
      await send(api, event, "⛔ Chỉ chủ phòng hoặc Admin mới được hủy ván.");
      return true;
    }
    noituRoom.stop(threadId, room.ownerId);
    await send(api, event, "🛑 Đã hủy phòng Nối Từ. Không cộng/trừ điểm.");
    return true;
  }
  if (["leave", "out", "quit"].includes(action)) {
    const result = noituRoom.leave(threadId, uid);
    if (!result.ok) return true;
    if (result.gameOver) {
      await send(api, event, "🏁 Ván Nối Từ kết thúc vì số người chơi còn lại dưới 2.");
    } else {
      await send(api, event, "👋 " + (result.player?.name || "Người chơi") + " đã rời phòng. " +
        (result.room ? currentPlayerLine(result.room.game) : ""));
    }
    return true;
  }
  if (action === "pass" || action === "skip") {
    const result = noituRoom.pass(threadId, uid);
    if (!result.ok) {
      await send(api, event, result.code === "NOT_TURN"
        ? "⏳ Chưa đến lượt bạn."
        : "⚠️ Không thể bỏ lượt lúc này.");
      return true;
    }
    await send(api, event, "⏭️ Đã bỏ lượt. " + currentPlayerLine(room.game));
    return true;
  }

  const result = noituRoom.play(threadId, uid, content);
  if (!result.ok) {
    if (result.code === "NOT_TURN") {
      const current = room.game?.players?.get(result.currentUid);
      await send(api, event, "⏳ Đang đến lượt " + (current?.name || "người chơi khác") + ".");
    } else if (result.code === "WRONG_LINK") {
      await send(api, event, "❌ Cụm tiếp theo phải bắt đầu bằng tiếng " + result.expected + ".");
    } else if (result.code === "DUPLICATE") {
      await send(api, event, "🔁 Cụm từ này đã được dùng rồi.");
    } else if (result.code === "INVALID_PHRASE") {
      await send(api, event, "💬 Hãy nhập cụm từ tiếng Việt gồm 2–4 tiếng.");
    }
    return true;
  }
  await updateNoituScore(Users || defaultUsers, uid, 1, { move: true, mode: "room" });
  await send(api, event,
    "✅ " + result.phrase.display + " · +1 điểm.\n" +
    "🎯 Đến lượt " + (result.nextPlayer?.name || "người chơi tiếp theo") + "."
  );
  return true;
}

async function startQuickNoitu({ api, event }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  const caro = require("../../core/runtime/services/games/caroService");
  if (game.get(threadId)?.status === "active" || ghepChu.get(threadId)?.status === "active" || noituRoom.get(threadId) || caro.get(threadId)) {
    return send(api, event, "⚠️ Nhóm đang có game khác. Hãy kết thúc game hiện tại trước khi mở Nối Từ Tốc Độ.");
  }
  const result = quickNoitu.start(threadId, uid, event?.data?.dName || event?.data?.name || "Người chơi");
  if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Nối Từ Tốc Độ.");
  scheduleQuickNoituExpiry(api, event, threadId);
  return send(api, event,
    "⚡ NỐI TỪ TỐC ĐỘ — 60 GIÂY\n" +
    "🧩 Từ mở màn: " + result.session.game.currentPhrase.display + "\n" +
    "👉 Trả lời trực tiếp bằng cụm 2–4 tiếng, bắt đầu bằng tiếng cuối của cụm hiện tại.\n" +
    "✅ Đúng: +1 điểm, +1 giây · ❌ Sai: -5 giây.\n" +
    "🛑 Gõ stop để kết thúc. Chỉ người mở ván được trả lời."
  );
}

async function handleQuickNoituText({ api, event, eventType, isSelf = false, Users }) {
  if ((eventType && eventType !== "message") || ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true)) return false;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return false;
  const session = quickNoitu.get(threadId);
  if (!session || session.status !== "active" || session.playerId !== uid) return false;

  const content = getPlainMessage(event);
  if (!content) return false;
  const prefix = String(global.config?.prefix || "/");
  if (content.startsWith(prefix)) return false;

  const action = content.toLocaleLowerCase("vi-VN");
  if (["stop", "cancel", "thua", "lose"].includes(action)) {
    const result = quickNoitu.stop(threadId, uid);
    if (!result.ok) return true;
    await finishQuickNoitu(api, event, result.session, "🛑 Bạn đã kết thúc lượt chơi.");
    return true;
  }

  const answer = action === "skip" ? session.game.currentPhrase.display : content;
  const result = quickNoitu.submit(threadId, uid, answer);
  if (result.code === "TIME_UP") {
    await finishQuickNoitu(api, event, result.session, "⌛ Hết giờ!");
    return true;
  }
  if (result.code === "NOT_PLAYER" || result.code === "NO_GAME") return false;

  scheduleQuickNoituExpiry(api, event, threadId);
  if (result.ok) {
    await updateNoituScore(Users || defaultUsers, uid, 1, { move: true, mode: "q" });
    await send(api, event,
      "✅ " + result.phrase.display + " · +" + result.score + " điểm · +1s\n" +
      "🧩 Từ tiếp theo phải bắt đầu bằng: " + result.phrase.last + "\n" +
      "⏱️ Còn " + Math.ceil(result.remainingMs / 1000) + " giây."
    );
    return true;
  }

  const message = result.code === "WRONG_LINK"
    ? "❌ Sai tiếng nối (cần bắt đầu bằng: " + result.expected + ")."
    : result.code === "DUPLICATE"
      ? "🔁 Cụm từ đã dùng rồi."
      : "💬 Hãy nhập cụm từ tiếng Việt gồm 2–4 tiếng.";
  await send(api, event, message + " Trừ 5 giây · Còn " + Math.ceil(result.remainingMs / 1000) + " giây.");
  return true;
}
function help(prefix) {
  return [
    "@Wuang 📖 NỐI TỪ TIẾNG VIỆT - ĐẠI CHIẾN TỪ VỰNG",
    "💤 Trạng thái: 🟢 BẬT",
    "",
    "🕹️ Chế độ chơi:",
    `➜ ${prefix}nt go : Đấu Solo với Bot (thắng bot +5⭐)`,
    `➜ ${prefix}nt q : Nối từ tốc độ 60s (đúng +1s, sai -5s)`,
    `➜ ${prefix}nt gc : Ghép Chữ vui nhộn`,
    `➜ ${prefix}nt room : Mở phòng đấu nhóm nhiều người (PVP)`,
    "",
    "👥 Phòng đấu nhóm:",
    `➜ ${prefix}nt join <mã> : Vào phòng chờ (Ví dụ: ${prefix}nt join A1B2)`,
    `➜ ${prefix}nt start : Chủ phòng bắt đầu ván (từ 2 người)`,
    `➜ ${prefix}nt leave / stop : Rời phòng hoặc hủy ván`,
    "➜ skip : Bỏ qua câu đố ghép chữ (-5s)",
    "",
    "🏆 Xếp hạng & tiện ích:",
    `➜ ${prefix}nt bxh [gc | q | room | all] [tháng] : Bảng vàng cao thủ`,
    `➜ ${prefix}nt check <từ> : Tra cứu ý nghĩa từ vựng`,
    `➜ ${prefix}nt words : Xem tổng số từ vựng trong kho`,
    "",
    "🖥️ Quản trị:",
    `➜ ${prefix}nt on / off : Bật hoặc Tắt game`,
    `➜ ${prefix}nt reset [gc | q | room | all] : Đặt lại điểm tháng`,
    "",
    `👉 Gõ ${prefix}nt go hoặc ${prefix}nt gc để chơi ngay!`
  ].join("\n");
}
async function sendGuide(api, event, prefix) {
  let imagePath;
  try {
    imagePath = await renderCanvas("noitu-guide", {}, { timeout: 20000, poolSize: 1 });
    return await api.sendMessage({
      msg: help(prefix),
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[NOITU_GUIDE]", error?.stack || error);
    return send(api, event, help(prefix));
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
}

function currentPlayerLine(session) {
  const player = session?.players.get(session?.turnUid);
  return player ? "🎯 Lượt tiếp theo: " + player.name + "." : "";
}

function currentMonthKey(now = Date.now()) {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

async function updateNoituScore(Users, uid, points = 1, options = {}) {
  const store = Users || defaultUsers;
  if (!store?.getData || !store?.setData || !uid) return false;
  try {
    const record = await store.getData(String(uid));
    const data = record?.data && typeof record.data === "object"
      ? { ...record.data }
      : (record && typeof record === "object" ? { ...record } : {});
    const profile = data.noitu && typeof data.noitu === "object" ? { ...data.noitu } : {};
    const delta = Math.max(0, Number(points) || 0);
    profile.points = Math.max(0, Number(profile.points) || 0) + delta;
    if (options.move) profile.moves = Math.max(0, Number(profile.moves) || 0) + 1;
    if (options.botWin) profile.botWins = Math.max(0, Number(profile.botWins) || 0) + 1;
    if (options.mode && options.mode !== "all") {
      profile.modes = { ...(profile.modes || {}) };
      profile.modes[options.mode] = Math.max(0, Number(profile.modes[options.mode]) || 0) + delta;
      const month = currentMonthKey();
      profile.months = { ...(profile.months || {}) };
      profile.months[month] = { ...(profile.months[month] || {}) };
      profile.months[month][options.mode] = Math.max(0, Number(profile.months[month][options.mode]) || 0) + delta;
      profile.months[month].all = Math.max(0, Number(profile.months[month].all) || 0) + delta;
    }
    data.noitu = profile;
    await store.setData(String(uid), data);
    return profile;
  } catch (error) {
    console.error("[NOITU_SCORE]", error?.message || error);
    return false;
  }
}

function createSoloBotSession(threadId, uid, name = "Người chơi", random = Math.random) {
  const result = game.start(threadId, uid, name);
  if (!result.ok) return result;
  const session = result.session;
  const botUid = "johntran-ai:" + String(threadId);
  const joined = game.join(threadId, botUid, "JOHNTRAN AI");
  const opening = noituEngine.parsePhrase(noituBotAI.chooseOpeningPhrase(random));
  if (!joined.ok || !opening) {
    game.stop(threadId);
    return { ok: false, code: "AI_INIT_FAILED" };
  }
  session.mode = "solo_bot";
  session.humanUid = String(uid);
  session.botUid = botUid;
  session.currentPhrase = opening;
  session.used = new Set([opening.normalized]);
  session.history = [opening.display];
  session.turnUid = String(uid);
  return { ok: true, session };
}

async function startSoloBotGame({ api, event }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  const name = String(event?.data?.dName || event?.data?.name || "Người chơi");
  const result = createSoloBotSession(threadId, uid, name);
  if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Nối Từ. Hãy kết thúc ván hiện tại trước.");
  return send(api, event,
    "⚔️ NỐI TỪ SOLO — ĐẤU VỚI JOHNTRAN AI\n\n" +
    "🧩 Từ mở màn: " + result.session.currentPhrase.display + "\n" +
    "🤖 AI sẽ tự nối từ sau mỗi lượt của bạn.\n" +
    "✅ Bạn ghi +1 điểm mỗi lượt đúng; nếu AI bí từ, bạn thắng +5⭐.\n" +
    "👉 Trả lời trực tiếp bằng cụm từ 2–4 tiếng. Gõ stop để dừng."
  );
}

async function playSoloBotTurn({ api, event, session, Users }) {
  const reply = noituBotAI.chooseReply(session);
  if (!reply) {
    game.stop(session.threadId);
    const score = await updateNoituScore(Users || defaultUsers, session.humanUid, 5, { botWin: true, mode: "solo" });
    const rewardLine = score
      ? "🎁 Đã cộng 5⭐ vào bảng điểm Nối Từ của bạn."
      : "⚠️ Bạn thắng, nhưng chưa lưu được điểm. Hãy kiểm tra database rồi thử lại với Admin.";
    await send(api, event,
      "🏆 BẠN ĐÃ THẮNG JOHNTRAN AI!\n" +
      "🤖 AI không tìm được cụm từ bắt đầu bằng tiếng " + session.currentPhrase.last + ".\n" +
      "⭐ Thưởng: +5 điểm.\n" + rewardLine
    );
    return true;
  }

  const botResult = game.play(session.threadId, session.botUid, reply.display);
  if (!botResult.ok) {
    game.stop(session.threadId);
    await send(api, event, "🏆 AI gặp lỗi nối từ. Bạn thắng ván này!");
    await updateNoituScore(Users || defaultUsers, session.humanUid, 5, { botWin: true, mode: "solo" });
    return true;
  }
  await send(api, event,
    "🤖 JOHNTRAN AI: " + botResult.phrase.display + "\n" +
    "🧩 Tiếng tiếp theo: " + botResult.phrase.last + "\n" +
    "🎯 Đến lượt bạn. " + currentPlayerLine(session)
  );
  return true;
}
function ghepChuCardData(session) {
  return {
    status: session.status,
    remainingSeconds: ghepChu.remainingSeconds(session),
    score: session.score,
    streak: session.streak,
    bestStreak: session.bestStreak,
    correct: session.correct,
    skipped: session.skipped,
    playerName: session.playerName,
    requesterAvatarUrl: session.requesterAvatarUrl,
    letters: session.puzzle?.letters || [],
    clue: session.puzzle?.clue || "",
    version: "1.0.2",
    botName: global.config?.name_bot || "CHÍ TÂM"
  };
}

async function sendGhepChuCard(api, event, session, caption = "") {
  let imagePath;
  try {
    imagePath = await renderCanvas("ghepchu", ghepChuCardData(session), {
      timeout: 20000,
      poolSize: 1
    });
    return await api.sendMessage({
      msg: caption,
      attachments: [imagePath],
      ttlKind: "card"
    }, event.threadId, event.type);
  } catch (error) {
    console.error("[GHEP_CHU_CARD]", error?.stack || error);
    const fallback = session.status === "active"
      ? `🎮 GHÉP CHỮ • ${ghepChu.remainingSeconds(session)}s\n🔤 ${(session.puzzle?.letters || []).join(" ")}\n💡 ${session.puzzle?.clue || ""}\n⭐ ${session.score} điểm • Chuỗi x${session.streak}`
      : `🏁 KẾT THÚC GHÉP CHỮ\n⭐ ${session.score} điểm • Đúng ${session.correct} câu • Bỏ qua ${session.skipped} câu`;
    return send(api, event, [caption, fallback].filter(Boolean).join("\n"));
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 70000);
      timer.unref?.();
    }
  }
}

function clearGhepChuTimer(threadId) {
  const timer = ghepChuTimers.get(String(threadId));
  if (timer) clearTimeout(timer);
  ghepChuTimers.delete(String(threadId));
}

function scheduleGhepChuExpiry(api, event, threadId) {
  clearGhepChuTimer(threadId);
  const session = ghepChu.get(threadId);
  if (!session || session.status !== "active") return;
  const delay = Math.max(20, ghepChu.remainingSeconds(session) * 1000);
  const timer = setTimeout(async () => {
    const current = ghepChu.get(threadId);
    if (!current || current.status !== "active") return;
    if (ghepChu.remainingSeconds(current) > 0) {
      scheduleGhepChuExpiry(api, event, threadId);
      return;
    }
    ghepChu.finish(threadId);
    clearGhepChuTimer(threadId);
    await sendGhepChuCard(api, event, current, "⌛ Hết giờ! Đây là kết quả ván Ghép Chữ của bạn.");
  }, delay);
  timer.unref?.();
  ghepChuTimers.set(String(threadId), timer);
}

async function finishGhepChu(api, event, session, caption) {
  clearGhepChuTimer(event.threadId);
  await sendGhepChuCard(api, event, session, caption || "🏁 Ván Ghép Chữ đã kết thúc!");
}

async function startGhepChu({ api, event }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  if (!uid || !threadId) return;
  if (game.get(threadId)?.status === "active") {
    return send(api, event, "⚠️ Nhóm đang có ván Nối Từ. Hãy dừng ván đó trước khi mở Ghép Chữ.");
  }
  const caro = require("../../core/runtime/services/games/caroService");
  if (caro.get(threadId)) {
    return send(api, event, "⚠️ Nhóm đang có ván Caro. Hãy kết thúc ván đó trước khi mở Ghép Chữ.");
  }
  if (quickNoitu.get(threadId)?.status === "active") return send(api, event, "⚠️ Nhóm đang có ván Nối Từ Tốc Độ. Hãy dừng ván đó trước.");
  if (noituRoom.get(threadId)) return send(api, event, "⚠️ Nhóm đang có phòng Nối Từ. Hãy kết thúc phòng trước.");
  const existing = ghepChu.get(threadId);
  if (existing?.status === "active" && ghepChu.remainingSeconds(existing) > 0) {
    scheduleGhepChuExpiry(api, event, threadId);
    return sendGhepChuCard(api, event, existing, "🎮 Ván Ghép Chữ đang diễn ra — tiếp tục thử sức nhé!");
  }

  let profile = {
    requesterName: String(event?.data?.dName || event?.data?.name || "Người chơi"),
    requesterAvatarUrl: ""
  };
  try {
    profile = await getRequesterProfile(api, event, { waitMs: 120, skipAvatarWarm: true });
  } catch {}

  const result = await ghepChu.start(
    threadId,
    uid,
    profile.requesterName || "Người chơi",
    profile.requesterAvatarUrl || ""
  );
  if (!result.ok) return send(api, event, "⚠️ Không thể bắt đầu ván Ghép Chữ lúc này.");
  scheduleGhepChuExpiry(api, event, threadId);
  return sendGhepChuCard(
    api,
    event,
    result.session,
    "@Wuang\n✅ 🎮 Trò chơi Ghép Chữ đã bắt đầu!\n👉 Gõ đáp án trực tiếp vào chat, gõ skip để bỏ qua (-5s), gõ stop để dừng ván chơi!\n📚 Từ điển: dict.minhqnd.com (@minhqnd) · CC BY-SA 4.0"
  );
}

function getPlainMessage(event) {
  const data = event?.data || {};
  const raw = data.content;
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object") {
    for (const key of ["title", "text", "content", "message", "body"]) {
      if (typeof raw[key] === "string" && raw[key].trim()) return raw[key].trim();
    }
  }
  for (const key of ["text", "message", "body"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
  }
  return "";
}

async function handleGhepChuText({ api, event, eventType, isSelf = false, Users }) {
  if ((eventType && eventType !== "message") || ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true)) return false;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return false;
  const session = ghepChu.get(threadId);
  if (!session || session.status !== "active" || session.playerId !== uid) return false;

  const content = getPlainMessage(event);
  if (!content) return false;
  const prefix = String(global.config?.prefix || "/");
  // Prefixed input remains available to the normal command pipeline.
  if (content.startsWith(prefix)) return false;

  const action = content.toLocaleLowerCase("vi-VN");
  if (["stop", "cancel", "thua", "lose"].includes(action)) {
    const result = ghepChu.stop(threadId, uid);
    if (!result.ok) return true;
    await finishGhepChu(api, event, result.session, "🛑 Bạn đã dừng ván Ghép Chữ.");
    return true;
  }

  if (action === "skip") {
    const result = await ghepChu.skip(threadId, uid);
    if (!result.ok && result.code !== "TIME_UP") return true;
    if (result.code === "TIME_UP") {
      await finishGhepChu(api, event, result.session, `⌛ Hết giờ sau khi bỏ qua. Đáp án vừa rồi: ${result.skippedAnswer || ""}`);
      return true;
    }
    scheduleGhepChuExpiry(api, event, threadId);
    await sendGhepChuCard(api, event, result.session, `⏭️ Đã bỏ qua: ${result.skippedAnswer}. Trừ 5 giây!`);
    return true;
  }

  const result = await ghepChu.submit(threadId, uid, content);
  if (result.code === "TIME_UP") {
    await finishGhepChu(api, event, result.session, "⌛ Hết giờ! Đây là kết quả ván Ghép Chữ.");
    return true;
  }
  if (!result.ok) {
    if (result.code === "WRONG") {
      await send(api, event, "❌ Chưa đúng rồi, thử sắp xếp lại nhé!");
    }
    return true;
  }

  await updateNoituScore(Users || defaultUsers, uid, result.points, { move: true, mode: "gc" });
  scheduleGhepChuExpiry(api, event, threadId);
  await sendGhepChuCard(api, event, result.session, `✅ Chính xác: ${result.completedAnswer}! +${result.points} điểm.`);
  return true;
}

async function handleNoiTuText({ api, event, eventType, isSelf = false, Users }) {
  if ((eventType && eventType !== "message") || ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true)) return false;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return false;
  const session = game.get(threadId);
  // Only enrolled players are captured; everyone else keeps normal chat.
  if (!session || session.status !== "active" || !session.players?.has(uid)) return false;
  if (session.mode === "solo_bot" && session.humanUid !== uid) return false;

  const content = getPlainMessage(event);
  if (!content) return false;
  const prefix = String(global.config?.prefix || "/");
  if (content.startsWith(prefix)) return false;

  const action = content.toLocaleLowerCase("vi-VN");
  if (["stop", "cancel", "thua", "lose"].includes(action)) {
    if (session.ownerId !== uid && !isAdmin(uid)) {
      await send(api, event, "⛔ Chỉ chủ ván hoặc Admin mới được dừng game.");
      return true;
    }
    game.stop(threadId);
    await send(api, event, "🛑 Đã dừng game Nối Từ. Mọi tin nhắn sau đó sẽ được xử lý bình thường.");
    return true;
  }

  if (["leave", "out", "quit"].includes(action)) {
    if (session.mode === "solo_bot") {
      game.stop(threadId);
      await send(api, event, "👋 Bạn đã rời ván Solo. Không cộng hoặc trừ điểm.");
      return true;
    }
    const result = game.leave(threadId, uid);
    if (!result.ok) return true;
    await send(api, event, result.empty
      ? "👋 Ván Nối Từ đã kết thúc vì không còn người chơi."
      : "👋 Bạn đã rời ván. " + currentPlayerLine(game.get(threadId)));
    return true;
  }

  if (action === "pass" || action === "skip") {
    const result = game.pass(threadId, uid);
    if (!result.ok) {
      await send(api, event, result.code === "NOT_TURN" ? "⏳ Chưa đến lượt bạn." : "⚠️ Không thể bỏ lượt.");
      return true;
    }
    if (session.mode === "solo_bot" && result.nextPlayer?.uid === session.botUid) {
      return playSoloBotTurn({ api, event, session, Users });
    }
    await send(api, event, "⏭️ Đã bỏ lượt. " + currentPlayerLine(game.get(threadId)));
    return true;
  }

  const result = game.play(threadId, uid, content);
  if (!result.ok) {
    if (result.code === "NOT_TURN") {
      const current = game.get(threadId)?.players?.get(result.currentUid);
      await send(api, event, "⏳ Đang đến lượt " + (current?.name || "người chơi khác") + ". Chờ chút nhé!");
    } else if (result.code === "WRONG_LINK") {
      const needed = session.currentPhrase?.display?.trim().split(/\s+/).at(-1) || result.expected;
      await send(api, event, "❌ Chưa nối đúng. Cụm từ cần bắt đầu bằng: " + needed + ".");
    } else if (result.code === "DUPLICATE") {
      await send(api, event, "🔁 Cụm từ này đã được dùng rồi. Nghĩ cụm khác nhé!");
    } else if (result.code === "INVALID_PHRASE") {
      await send(api, event, "💬 Hãy trả lời bằng một cụm từ tiếng Việt gồm 2–4 tiếng.");
    }
    return true;
  }

  await updateNoituScore(Users || defaultUsers, uid, 1, { move: true, mode: session.mode === "solo_bot" ? "solo" : "classic" });
  if (session.mode === "solo_bot" && result.nextPlayer?.uid === session.botUid) {
    return playSoloBotTurn({ api, event, session, Users });
  }
  const nextName = result.nextPlayer?.name || "người chơi tiếp theo";
  await send(api, event, "✅ " + result.phrase.display + " · +1 điểm. Đến lượt " + nextName + "!");
  return true;
}

function isNoituEnabled(Threads, threadId) {
  const record = Threads?.getCachedData?.(String(threadId));
  const data = record?.data || record || {};
  return data.noitu_enabled !== false;
}

async function setNoituEnabled(Threads, threadId, enabled) {
  const record = await Threads.getData(String(threadId));
  const data = { ...(record?.data || {}), noitu_enabled: Boolean(enabled) };
  if (typeof Threads.setDataAndWait === "function") {
    await Threads.setDataAndWait(String(threadId), data);
  } else {
    await Threads.setData(String(threadId), data);
  }
  return Boolean(enabled);
}

function stopNoituGames(threadId) {
  const classic = game.get(threadId);
  if (classic) game.stop(threadId);

  const quick = quickNoitu.get(threadId);
  if (quick) quickNoitu.stop(threadId, quick.playerId);
  clearQuickNoituTimer(threadId);

  const gc = ghepChu.get(threadId);
  if (gc) ghepChu.stop(threadId, gc.playerId);
  clearGhepChuTimer(threadId);

  if (noituRoom.get(threadId)) noituRoom.finish(threadId);
}

async function handleActiveGameText(context) {
  if (!isNoituEnabled(context.Threads || defaultThreads, context.event?.threadId)) return false;
  if (await handleNoituRoomText(context)) return true;
  if (await handleQuickNoituText(context)) return true;
  if (await handleGhepChuText(context)) return true;
  if (await handleNoiTuText(context)) return true;
  return false;
}

async function leaderboard(Users, mode = "all", month = null) {
  if (!Users?.getAll) return [];
  const rows = Users.getAll().map(row => {
    const profile = row?.data?.noitu || {};
    const points = month
      ? Number(profile.months?.[month]?.[mode] ?? (mode === "all" ? profile.months?.[month]?.all : 0)) || 0
      : (mode === "all"
        ? Number(profile.points) || 0
        : Number(profile.modes?.[mode]) || 0);
    return {
      uid: String(row.userId || ""),
      name: String(profile.name || row?.data?.name || row.userId || "Người chơi"),
      points: Math.max(0, points),
      moves: Math.max(0, Number(profile.moves) || 0),
      botWins: Math.max(0, Number(profile.botWins) || 0)
    };
  });
  return rows.filter(row => row.uid && row.points > 0)
    .sort((a, b) => b.points - a.points || b.moves - a.moves)
    .slice(0, 10);
}

async function resetNoituScores(Users, mode = "all") {
  if (!Users?.getAll || !Users?.getData || !Users?.setData) return 0;
  const ids = Users.getAll().map(row => String(row.userId || "")).filter(Boolean);
  let changed = 0;
  for (const uid of ids) {
    const record = await Users.getData(uid);
    const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
    const profile = data.noitu && typeof data.noitu === "object" ? { ...data.noitu } : null;
    if (!profile) continue;

    if (mode === "all") {
      delete data.noitu;
    } else {
      const modes = { ...(profile.modes || {}) };
      const removed = Math.max(0, Number(modes[mode]) || 0);
      modes[mode] = 0;
      profile.points = Math.max(0, (Number(profile.points) || 0) - removed);
      profile.modes = modes;
      const months = { ...(profile.months || {}) };
      for (const [month, original] of Object.entries(months)) {
        const row = { ...(original || {}) };
        const monthRemoved = Math.max(0, Number(row[mode]) || 0);
        row[mode] = 0;
        row.all = Math.max(0, (Number(row.all) || 0) - monthRemoved);
        months[month] = row;
      }
      profile.months = months;
      data.noitu = profile;
    }
    await Users.setData(uid, data);
    changed++;
  }
  return changed;
}

async function checkNoituWord(term) {
  const normalized = ghepChu.normalizePhrase(term);
  if (!normalized) return null;
  try {
    const entry = await ghepChu.lookupVietnameseTerm(normalized);
    if (entry) return entry;
  } catch { /* fallback below */ }
  const fallback = ghepChu.FALLBACK_WORD_BANK.find(item =>
    ghepChu.normalizePhrase(item.answer) === normalized
  );
  return fallback
    ? { answer: fallback.answer, definition: fallback.definition, dictionarySource: "Kho dự phòng JOHNTRAN", source: "fallback" }
    : null;
}

module.exports.run = async function ({ args = [], api, event, Users, Threads }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  const prefix = global.config?.prefix || "/";
  if (!uid || !threadId) return;
  const action = String(args[0] || "").trim().toLowerCase();
  if (!action || action === "help") return sendGuide(api, event, prefix);

  if (action === "on" || action === "off") {
    if (!isAdmin(uid)) return send(api, event, "⛔ Chỉ Admin bot mới được bật/tắt Nối Từ.");
    try {
      await setNoituEnabled(Threads || defaultThreads, threadId, action === "on");
      if (action === "off") stopNoituGames(threadId);
      return send(api, event, action === "on"
        ? "✅ Đã bật Nối Từ trong nhóm hiện tại."
        : "🚫 Đã tắt Nối Từ trong nhóm hiện tại. Các ván đang chạy đã được hủy.");
    } catch (error) {
      return send(api, event, "❌ Không thể lưu trạng thái Nối Từ: " + (error?.message || error));
    }
  }

  if (action === "check") {
    const term = args.slice(1).join(" ").trim();
    if (!term) return send(api, event, "📖 Cách dùng: " + prefix + "nt check <từ hoặc cụm từ>");
    if (term.length > 80) return send(api, event, "⚠️ Từ cần tra cứu quá dài.");
    const entry = await checkNoituWord(term);
    if (!entry) return send(api, event, "🔎 Không tìm thấy nghĩa tiếng Việt cho: " + term);
    return send(api, event,
      "📖 TRA CỨU TỪ VỰNG\n" +
      "🔤 " + entry.answer + "\n" +
      "💡 " + entry.definition + "\n" +
      "📚 Nguồn: " + entry.dictionarySource
    );
  }

  if (action === "words") {
    try { await ghepChu.refreshApiWordPool(); } catch { /* cache vẫn dùng được */ }
    const stats = ghepChu.getDictionaryStats();
    return send(api, event,
      "📚 KHO TỪ VỰNG JOHNTRAN\n" +
      "⚡ Từ API đã nạp: " + stats.apiCached + "/" + stats.apiPoolLimit + "\n" +
      "🛟 Từ dự phòng: " + stats.fallbackWords + "\n" +
      "📦 Tổng mục từ đang có trong cache: " + stats.totalCached + "\n" +
      "🌐 Nguồn tra cứu: " + stats.source + "\n" +
      "ℹ️ Đây là số từ đang nạp trong bộ nhớ, không phải tổng quy mô toàn bộ từ điển API."
    );
  }

  if (action === "reset") {
    if (!isAdmin(uid)) return send(api, event, "⛔ Chỉ Admin bot mới được reset BXH Nối Từ.");
    const mode = String(args[1] || "all").toLowerCase();
    if (!["gc", "q", "room", "all"].includes(mode)) {
      return send(api, event, "⚠️ Cách dùng: " + prefix + "nt reset [gc|q|room|all]");
    }
    try {
      const count = await resetNoituScores(Users || defaultUsers, mode);
      return send(api, event, "✅ Đã reset điểm Nối Từ chế độ " + mode.toUpperCase() + " của " + count + " người dùng.");
    } catch (error) {
      return send(api, event, "❌ Reset BXH thất bại: " + (error?.message || error));
    }
  }

  if (action === "gc") return startGhepChu({ api, event });
  if (action === "q") return startQuickNoitu({ api, event });
  if (action === "room") return startNoituRoom({ api, event });
  if (action === "skip" && ghepChu.get(threadId)?.status === "active") return handleGhepChuText({ api, event: { ...event, data: { ...event.data, content: "skip" } } });
  if (action === "start" && noituRoom.get(threadId)?.status === "waiting") return startNoituRoomGame({ api, event });
  if (action === "go") {
    const caro = require("../../core/runtime/services/games/caroService");
    if (quickNoitu.get(threadId)?.status === "active" || noituRoom.get(threadId) || ghepChu.get(threadId)?.status === "active" || caro.get(threadId)) {
      return send(api, event, "⚠️ Nhóm đang có game khác. Hãy kết thúc game hiện tại trước khi mở Nối Từ Solo.");
    }
    return startSoloBotGame({ api, event });
  }
  if (action === "start") {
    const caro = require("../../core/runtime/services/games/caroService");
    if (quickNoitu.get(threadId)?.status === "active") return send(api, event, "⚠️ Nhóm đang có ván Nối Từ Tốc Độ. Hãy dừng ván đó trước khi mở Nối Từ.");
    if (noituRoom.get(threadId)) return send(api, event, "⚠️ Nhóm đang có phòng Nối Từ. Hãy kết thúc phòng đó trước.");
    if (ghepChu.get(threadId)?.status === "active") return send(api, event, "⚠️ Nhóm đang có ván Ghép Chữ. Hãy dừng ván đó trước khi mở Nối Từ.");
    if (caro.get(threadId)) return send(api, event, "⚠️ Nhóm đang có ván Caro. Hãy kết thúc ván đó trước khi mở Nối Từ.");
    const name = String(event?.data?.dName || event?.data?.name || "Người chơi");
    const result = game.start(threadId, uid, name);
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Nối Từ. Gõ join để vào lượt.");
    return send(api, event, "🔗 ĐÃ BẮT ĐẦU GAME NỐI TỪ\n\n🧩 Từ mở màn: " +
      result.session.currentPhrase.display + "\n👥 Người chơi: 1\n👉 Chủ ván nhập cụm từ bắt đầu bằng tiếng cuối của từ mở màn." +
      "\n📌 Gõ " + prefix + "nt join để những người khác tham gia.");
  }

  if (action === "join" && args[1]) {
    const result = noituRoom.join(threadId, args[1], uid, event?.data?.dName || event?.data?.name || "Người chơi");
    if (!result.ok) {
      const messages = {
        ROOM_NOT_FOUND: "⚠️ Không tìm thấy mã phòng.",
        WRONG_GROUP: "⚠️ Mã phòng này thuộc nhóm khác.",
        NOT_WAITING: "⚠️ Phòng đã bắt đầu hoặc đã đóng.",
        ALREADY_JOINED: "Bạn đã ở trong phòng.",
        FULL: "⚠️ Phòng đã đủ 8 người."
      };
      return send(api, event, messages[result.code] || "⚠️ Không thể tham gia phòng.");
    }
    return send(api, event, "✅ " + result.player.name + " đã tham gia phòng " + result.room.code +
      " (" + result.room.players.length + "/" + result.room.maxPlayers + ").\n" +
      "👑 Chủ phòng: " + result.room.ownerName + ". Gõ /nt start khi đủ người.");
  }

  if (action === "join") {
    if (game.get(threadId)?.mode === "solo_bot") return send(api, event, "⚠️ Đây là ván Solo với AI, không nhận thêm người chơi.");
    const result = game.join(threadId, uid, event?.data?.dName || event?.data?.name || "Người chơi");
    if (!result.ok) {
      const messages = {
        NO_GAME: "⚠️ Chưa có ván. Gõ " + prefix + "nt go để tạo ván.",
        ALREADY_JOINED: "Bạn đã ở trong ván."
      };
      return send(api, event, messages[result.code] || "⚠️ Không thể tham gia ván.");
    }
    return send(api, event, "✅ " + result.player.name + " đã tham gia. Hiện có " +
      result.count + " người chơi.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "leave" && noituRoom.get(threadId)) {
    const result = noituRoom.leave(threadId, uid);
    if (!result.ok) return send(api, event, "⚠️ Bạn không ở trong phòng Nối Từ.");
    if (result.gameOver) return send(api, event, "🏁 Phòng Nối Từ kết thúc vì không còn đủ người chơi.");
    return send(api, event, "👋 Đã rời phòng Nối Từ.");
  }

  if (action === "leave") {
    if (game.get(threadId)?.mode === "solo_bot") {
      game.stop(threadId);
      return send(api, event, "👋 Đã kết thúc ván Solo với AI. Không cộng hoặc trừ điểm.");
    }
    const result = game.leave(threadId, uid);
    if (!result.ok) return send(api, event, result.code === "NO_GAME" ? "⚠️ Chưa có ván đang chạy." : "⚠️ Bạn chưa tham gia ván.");
    if (result.empty) return send(api, event, "👋 Bạn đã rời ván. Ván chơi đã kết thúc vì không còn người chơi.");
    return send(api, event, "👋 Đã rời ván.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "pass") {
    const session = game.get(threadId);
    const result = game.pass(threadId, uid);
    if (!result.ok) return send(api, event, result.code === "NOT_TURN" ? "⏳ Chưa đến lượt bạn." : "⚠️ Bạn chưa tham gia ván.");
    if (session?.mode === "solo_bot" && result.nextPlayer?.uid === session.botUid) {
      return playSoloBotTurn({ api, event, session, Users });
    }
    return send(api, event, "⏭️ Đã bỏ lượt.\n" + currentPlayerLine(game.get(threadId)));
  }

  if (action === "stop") {
    const room = noituRoom.get(threadId);
    if (room) {
      if (room.ownerId !== uid && !isAdmin(uid)) return send(api, event, "⛔ Chỉ chủ phòng hoặc Admin mới được hủy phòng.");
      noituRoom.stop(threadId, room.ownerId);
      return send(api, event, "🛑 Đã hủy phòng Nối Từ.");
    }
    const quickSession = quickNoitu.get(threadId);
    if (quickSession?.status === "active" && quickSession.playerId === uid) {
      const stopped = quickNoitu.stop(threadId, uid);
      return finishQuickNoitu(api, event, stopped.session, "🛑 Bạn đã kết thúc lượt chơi.");
    }
    const gcSession = ghepChu.get(threadId);
    if (gcSession?.status === "active" && gcSession.playerId === uid) {
      const stopped = ghepChu.stop(threadId, uid);
      return finishGhepChu(api, event, stopped.session, "🛑 Bạn đã dừng ván Ghép Chữ.");
    }
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Không có ván nào đang chạy.");
    if (session.ownerId !== uid && !isAdmin(uid)) return send(api, event, "⛔ Chỉ chủ ván hoặc Admin mới được dừng.");
    game.stop(threadId);
    return send(api, event, "🛑 Đã dừng game Nối Từ.");
  }

  if (action === "rank" || action === "bxh") {
    const allowedModes = ["gc", "q", "room", "all"];
    const mode = allowedModes.includes(String(args[1] || "").toLowerCase())
      ? String(args[1]).toLowerCase()
      : "all";
    const monthToken = args.slice(1).find(value => /^\d{4}-\d{2}$/.test(String(value)));
    const monthKeyword = args.slice(1).some(value => ["thang", "tháng", "month"].includes(String(value).toLowerCase()));
    const month = monthToken || (monthKeyword ? currentMonthKey() : null);
    const rows = await leaderboard(Users || defaultUsers, mode, month);
    if (!rows.length) return send(api, event,
      "🏆 Chưa có dữ liệu BXH Nối Từ " + mode.toUpperCase() + (month ? " tháng " + month : "") + ".");
    const lines = rows.map((row, index) =>
      (index + 1) + ". " + row.name + " — " + row.points + " điểm" +
      (mode === "all" && row.botWins ? " · " + row.botWins + " lần thắng AI" : "")
    );
    return send(api, event,
      "🏆 BẢNG XẾP HẠNG NỐI TỪ " + mode.toUpperCase() + (month ? " • " + month : "") +
      "\n\n" + lines.join("\n")
    );
  }
  return sendGuide(api, event, prefix);
};
module.exports.handleEvent = handleActiveGameText;
module.exports._test = { help, leaderboard, resetNoituScores, sendGuide, ghepChuCardData, startGhepChu, startQuickNoitu, handleQuickNoituText, startNoituRoom, startNoituRoomGame, handleNoituRoomText, handleGhepChuText, handleNoiTuText, handleActiveGameText, getPlainMessage, updateNoituScore, createSoloBotSession, startSoloBotGame, playSoloBotTurn, isNoituEnabled, setNoituEnabled, stopNoituGames, checkNoituWord, currentMonthKey };