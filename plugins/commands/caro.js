"use strict";

const fs = require("node:fs");
const { withRequesterMention } = require("../../core/mentions");
const game = require("../../core/runtime/services/games/caroService");
const workerRender = require("../../core/canvas/workerRender");

// One live Caro canvas card per group. A replacement is sent first; only
// after Zalo returns its message IDs do we recall the previous board image.
const boardCards = new Map();
const boardUpdateQueues = new Map();
const pendingModeSelections = new Map();
const PENDING_MODE_SELECTION_MS = 55 * 1000;

function snapshotBoardSession(session) {
  return {
    ...session,
    board: Array.isArray(session?.board) ? session.board.slice() : [],
    players: { ...(session?.players || {}) }
  };
}

function getBoardRecallTargets(response) {
  const messages = [
    ...(response?.message ? [response.message] : []),
    ...(Array.isArray(response?.attachment) ? response.attachment : [])
  ];
  const unique = new Map();
  for (const message of messages) {
    const msgId = message?.msgId;
    const cliMsgId = message?.cliMsgId;
    if ((typeof msgId !== "number" && typeof msgId !== "string") ||
        (typeof cliMsgId !== "number" && typeof cliMsgId !== "string")) continue;
    unique.set(String(msgId) + ":" + String(cliMsgId), { msgId, cliMsgId });
  }
  return [...unique.values()];
}

function rememberBoardResponse(threadId, response) {
  const key = String(threadId);
  const targets = getBoardRecallTargets(response);
  if (!targets.length) return 0;

  // Preserve IDs of older cards that Zalo temporarily failed to recall.
  const pending = boardCards.get(key) || [];
  const unique = new Map();
  for (const target of [...pending, ...targets]) {
    unique.set(String(target.msgId) + ":" + String(target.cliMsgId), target);
  }
  boardCards.set(key, [...unique.values()]);
  return targets.length;
}

async function recallBoardMessages(api, threadId, type, messages) {
  const pending = Array.isArray(messages) ? messages : [];
  if (!pending.length) return { recalled: 0, failed: [] };
  if (typeof api?.undo !== "function") return { recalled: 0, failed: pending.slice() };

  let recalled = 0;
  const failed = [];
  for (const target of pending) {
    try {
      await api.undo({ msgId: target.msgId, cliMsgId: target.cliMsgId }, String(threadId), type);
      recalled += 1;
    } catch (error) {
      failed.push(target);
      console.error("[CARO_RECALL] Không thể thu hồi card cũ:", error?.message || error);
    }
  }
  return { recalled, failed };
}

async function recallPreviousBoard(api, threadId, type) {
  const key = String(threadId);
  const pending = boardCards.get(key);
  if (!pending?.length) return true;

  const result = await recallBoardMessages(api, key, type, pending);
  if (result.failed.length) boardCards.set(key, result.failed);
  else boardCards.delete(key);
  return result.failed.length === 0;
}

async function sendBoardReplacement(api, threadId, type, sendReplacement) {
  const key = String(threadId);
  if (typeof sendReplacement !== "function") {
    throw new TypeError("sendReplacement must be a function");
  }

  // Do not touch the existing board until Zalo confirms the new send.
  const response = await sendReplacement();
  const replacementTargets = getBoardRecallTargets(response);
  if (!replacementTargets.length) {
    console.error("[CARO_CANVAS] Zalo did not return message IDs for the new board; keeping the previous card.");
    return response;
  }

  const previousTargets = boardCards.get(key) || [];
  const recalled = await recallBoardMessages(api, key, type, previousTargets);

  // Track the new board plus any older cards whose recall failed, so they
  // can be retried on the next successful board update.
  const unique = new Map();
  for (const target of [...replacementTargets, ...recalled.failed]) {
    unique.set(String(target.msgId) + ":" + String(target.cliMsgId), target);
  }
  boardCards.set(key, [...unique.values()]);
  return response;
}

function enqueueBoardUpdate(threadId, operation) {
  const key = String(threadId);
  const previous = boardUpdateQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  boardUpdateQueues.set(key, current);
  return current.finally(() => {
    if (boardUpdateQueues.get(key) === current) boardUpdateQueues.delete(key);
  });
}

module.exports.config = {
  name: "caro",
  aliases: [],
  version: "1.0.0",
  role: 0,
  author: "Wuang",
  description: "Cờ Caro 16x16: đấu AI hoặc PvP",
  category: "Game",
  usage: "caro [solo|pvp|join|bxh|reset|on|off|help]",
  cooldowns: 0,
  dependencies: { canvas: "" }
};

const EMPTY_STATS = () => ({ points: 0, wins: 0, losses: 0, draws: 0, games: 0 });

function normalizeModeStats(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    points: Number(source.points) || 0,
    wins: Math.max(0, Number(source.wins) || 0),
    losses: Math.max(0, Number(source.losses) || 0),
    draws: Math.max(0, Number(source.draws) || 0),
    games: Math.max(0, Number(source.games) || 0)
  };
}

function normalizeCaro(value) {
  const source = value && typeof value === "object" ? value : {};
  const months = source.months && typeof source.months === "object" ? source.months : {};
  const normalizedMonths = {};
  for (const [month, entry] of Object.entries(months)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    normalizedMonths[month] = {
      solo: normalizeModeStats(entry?.solo),
      pvp: normalizeModeStats(entry?.pvp)
    };
  }
  return {
    name: String(source.name || ""),
    stars: Math.max(0, Number(source.stars) || 0),
    solo: normalizeModeStats(source.solo),
    pvp: normalizeModeStats(source.pvp),
    months: normalizedMonths
  };
}

function currentMonthKey() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function isAdmin(uid) {
  const candidates = [
    ...(Array.isArray(global.users?.admin) ? global.users.admin : []),
    ...(Array.isArray(global.config?.admin?.users) ? global.config.admin.users : [])
  ];
  return candidates.some(value => String(value) === String(uid));
}

async function send(api, event, msg) {
  return api.sendMessage(withRequesterMention(event, { msg }), event.threadId, event.type);
}

function getRawApi(api) {
  if (!api || typeof api.sendMessage !== "function" ||
      !Object.prototype.hasOwnProperty.call(api, "sendMessage")) return api;
  const parent = Object.getPrototypeOf(api);
  return parent && typeof parent.sendMessage === "function" ? parent : api;
}

function selectionKey(threadId, uid) {
  return String(threadId || "") + ":" + String(uid || "");
}

function rememberModeSelection(threadId, uid, now = Date.now()) {
  if (!threadId || !uid) return false;
  const key = selectionKey(threadId, uid);
  pendingModeSelections.set(key, now + PENDING_MODE_SELECTION_MS);
  if (pendingModeSelections.size > 500) {
    for (const [entry, expiresAt] of pendingModeSelections) {
      if (expiresAt <= now) pendingModeSelections.delete(entry);
      if (pendingModeSelections.size <= 350) break;
    }
  }
  return true;
}

function hasPendingModeSelection(threadId, uid, now = Date.now()) {
  const key = selectionKey(threadId, uid);
  const expiresAt = pendingModeSelections.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    pendingModeSelections.delete(key);
    return false;
  }
  return true;
}

function clearModeSelection(threadId, uid) {
  return pendingModeSelections.delete(selectionKey(threadId, uid));
}

function parseModeChoice(value) {
  const text = String(value || "").trim().toLocaleLowerCase("vi-VN");
  const match = text.match(/^(?:ch[oọ]n\s*)?([12])$/u);
  return match ? (match[1] === "1" ? "solo" : "pvp") : null;
}

function parseCellChoice(value) {
  const text = String(value || "").trim().toLocaleLowerCase("vi-VN");
  const match = text.match(/^(?:ch[oọ]n\s*)?(\d{1,3})$/u);
  if (!match) return null;
  const cell = Number(match[1]);
  return Number.isInteger(cell) && cell >= 1 && cell <= 256 ? cell : null;
}

function modeMenuText(prefix) {
  return [
    "⚔️ CARO 16×16 · CHỌN CHẾ ĐỘ",
    "",
    "1️⃣ ĐẤU VỚI AI — Solo, đánh luân phiên với Bot.",
    "2️⃣ ĐẤU PvP — Tạo phòng để người khác tham gia.",
    "",
    "👉 Gửi 1 hoặc “chọn 1” để đấu AI.",
    "👉 Gửi 2 hoặc “chọn 2” để tạo phòng PvP.",
    "",
    "Lệnh nhanh: " + prefix + "caro solo | " + prefix + "caro pvp",
    "⏳ Lựa chọn có hiệu lực trong 55 giây."
  ].join("\n");
}

async function openModeMenu(context) {
  const { api, event } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const current = game.get(threadId);
  if (current && current.status !== "ended") {
    return sendBoard(api, event, current, "⚔️ BÀN CỜ CARO HIỆN TẠI");
  }
  rememberModeSelection(threadId, uid);
  const prefix = global.config?.prefix || "/";
  return send(api, event, modeMenuText(prefix));
}

async function isGameEnabled(Threads, threadId) {
  if (!Threads || !threadId) return true;
  let record = Threads.getCachedData?.(threadId);
  if (!record || typeof record.then === "function") {
    record = await Threads.getData(threadId).catch(() => null);
  }
  const data = record?.data && typeof record.data === "object" ? record.data : record;
  return data?.caro_enabled !== false;
}

async function setGameEnabled(Threads, threadId, enabled) {
  const record = await Threads.getData(threadId);
  const data = { ...(record?.data || {}), caro_enabled: Boolean(enabled) };
  if (typeof Threads.setDataAndWait === "function") {
    await Threads.setDataAndWait(threadId, data);
  } else {
    await Threads.setData(threadId, data);
  }
}

function renderBoard(board) {
  const lines = [];
  for (let row = 0; row < 16; row += 1) {
    const cells = [];
    for (let col = 0; col < 16; col += 1) {
      const index = row * 16 + col;
      const value = board[index];
      cells.push(value ? ` ${value} ` : String(index + 1).padStart(3, "0"));
    }
    lines.push(String(row + 1).padStart(2, "0") + " | " + cells.join(" "));
  }
  return lines.join("\n");
}

function turnLine(session) {
  if (!session) return "";
  if (session.status === "waiting") {
    return "⏳ Đang chờ người chơi thứ hai tham gia phòng Caro.";
  }
  if (session.status !== "active") return "";
  const player = session.players[session.turnSymbol];
  if (!player) return "";
  const name = player.kind === "bot" ? "🤖 Bot AI" : player.name;
  return "🎯 Lượt " + session.turnSymbol + ": " + name +
    "\n⏳ Mỗi lượt có 60 giây. Nhập số ô từ 001–256 để đánh.";
}

function boardCaption(session, heading = "⚔️ BÀN CỜ CARO 16×16", extraLines = []) {
  return [
    heading,
    "Chế độ: " + (session.mode === "solo" ? "Solo đấu AI" : "PvP") + " • Nước đi: " + session.moves,
    turnLine(session),
    "💡 Ô trống hiện số 001–256; ví dụ nhập 125.",
    ...extraLines
  ].filter(Boolean).join("\n");
}

function boardMessage(session, heading = "⚔️ BÀN CỜ CARO 16×16") {
  return [boardCaption(session, heading), renderBoard(session.board)].filter(Boolean).join("\n");
}

async function sendBoard(api, event, session, heading, extraLines = []) {
  const threadId = String(event?.threadId || session?.threadId || "");
  const boardSession = snapshotBoardSession(session);
  return enqueueBoardUpdate(threadId, async () => {
    let imagePath;
    const caption = boardCaption(boardSession, heading, extraLines);
    try {
      imagePath = await renderCanvas("caro", { session: boardSession }, { timeout: 20000, poolSize: 1 });

      // recallAfterMs: 0 disables the generic 60-second TTL for the live board.
      // Send the new board first; sendBoardReplacement recalls the old card only
      // after this send succeeds and Zalo supplies the new message IDs.
      const response = await sendBoardReplacement(api, threadId, event.type, () =>
        api.sendMessage(withRequesterMention(event, {
          msg: caption,
          attachments: [imagePath],
          recallAfterMs: 0
        }), threadId, event.type)
      );
      return response;
    } catch (error) {
      console.error("[CARO_CANVAS]", error?.stack || error);
      // Keep the previous image if rendering or sending the replacement fails.
      return send(api, event, [caption, renderBoard(boardSession.board)].filter(Boolean).join("\n"));
    } finally {
      if (imagePath) {
        const timer = setTimeout(() => {
          try { fs.rmSync(imagePath, { force: true }); } catch {}
        }, 60000);
        timer.unref?.();
      }
    }
  });
}

function help(prefix) {
  return [
    "⚔️ GAME CỜ CARO 16×16",
    "",
    "🎮 CHẾ ĐỘ CHƠI",
    `${prefix}caro solo [x/o] [truoc/sau] — Đấu Bot AI`,
    `${prefix}caro pvp [x/o] — Tạo phòng 2 người`,
    "join caro hoặc " + prefix + "caro join — Tham gia phòng PvP",
    "",
    "🎯 CÁCH ĐÁNH",
    "• Bàn cờ có 256 ô, đánh bằng cách gửi số ô đang hiển thị (001–256).",
    "• Năm quân liên tiếp theo hàng, cột hoặc đường chéo sẽ thắng.",
    "• Mỗi lượt có 60 giây; quá giờ sẽ bị xử thua.",
    "• Solo mặc định bạn cầm X và đi trước. truoc/sau chọn người đi trước; x/o chọn quân.",
    "",
    "⚙️ LỆNH TRONG VÁN",
    "lose — Đầu hàng • leave — Rời phòng • stop — Hủy ván",
    `${prefix}caro board — Xem lại bàn cờ`,
    "",
    "🏆 XẾP HẠNG",
    `${prefix}caro bxh [all/solo/pvp] [tháng hoặc YYYY-MM]`,
    `${prefix}caro reset [solo/pvp] [all] — Admin đặt lại điểm`,
    "",
    "👑 ADMIN",
    `${prefix}caro on | off — Bật/tắt Caro trong nhóm hiện tại`,
    "",
    "👉 Gõ " + prefix + "caro solo hoặc " + prefix + "caro pvp để bắt đầu!"
  ].join("\n");
}

async function updateCaroStats(Users, player, mode, result) {
  if (!player || player.kind !== "human" || !player.uid || !Users?.getData || !Users?.setData) {
    return null;
  }

  try {
  const uid = String(player.uid);
  const record = await Users.getData(uid);
  const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
  const caro = normalizeCaro(data.caro);
  if (player.name) caro.name = String(player.name).slice(0, 40);

  const monthlyKey = currentMonthKey();
  const monthStats = caro.months[monthlyKey] || { solo: EMPTY_STATS(), pvp: EMPTY_STATS() };
  const modeStats = caro[mode] || EMPTY_STATS();
  const monthModeStats = monthStats[mode] || EMPTY_STATS();

  const rawDelta = result === "win" ? 2 : result === "loss" ? -1 : 0;
  const oldStars = caro.stars;
  caro.stars = Math.max(0, caro.stars + rawDelta);
  const actualStarsDelta = caro.stars - oldStars;

  for (const stats of [modeStats, monthModeStats]) {
    stats.games += 1;
    if (result === "win") stats.wins += 1;
    else if (result === "loss") stats.losses += 1;
    else stats.draws += 1;
    stats.points += rawDelta;
  }

  caro[mode] = modeStats;
  monthStats[mode] = monthModeStats;
  caro.months[monthlyKey] = monthStats;
  data.caro = caro;
  await Users.setData(uid, data);

  return { rawDelta, actualStarsDelta, stars: caro.stars };
  } catch (error) {
    console.error("[CARO_STATS]", error?.message || error);
    return null;
  }
}

async function settleGame({ api, event, Users, result }) {
  const session = result.session;
  const scoreLines = [];

  if (result.draw) {
    for (const symbol of ["X", "O"]) {
      const player = session.players[symbol];
      if (player?.kind === "human") {
        const score = await updateCaroStats(Users, player, session.mode, "draw");
        scoreLines.push(score
          ? `• ${player.name}: hòa, không đổi sao.`
          : `• ${player.name}: hòa; chưa lưu được thống kê.`);
      }
    }
  } else {
    const winner = session.players[result.winnerSymbol];
    const loser = session.players[result.loserSymbol || (result.winnerSymbol === "X" ? "O" : "X")];

    if (winner?.kind === "human") {
      const score = await updateCaroStats(Users, winner, session.mode, "win");
      scoreLines.push(score
        ? `• ${winner.name}: +2⭐ (hiện có ${score.stars}⭐).`
        : `• ${winner.name}: thắng ván này nhưng chưa lưu được sao.`);
    }
    if (loser?.kind === "human") {
      const score = await updateCaroStats(Users, loser, session.mode, "loss");
      if (score) {
        const penalty = score.actualStarsDelta === 0 ? "0⭐ (đã ở mức 0⭐)" : "-1⭐";
        scoreLines.push(`• ${loser.name}: ${penalty} (hiện có ${score.stars}⭐).`);
      } else {
        scoreLines.push(`• ${loser.name}: thua ván này nhưng chưa lưu được thống kê.`);
      }
    }
  }

  let title = result.draw
    ? "🤝 VÁN CARO HÒA!"
    : `🏆 ${session.players[result.winnerSymbol]?.name || "Người chơi"} THẮNG!`;
  let reasonLine = "";
  if (result.reason === "timeout") {
    title = `⏰ HẾT GIỜ — ${session.players[result.winnerSymbol]?.name || "Đối thủ"} THẮNG!`;
    reasonLine = "Người chơi đến lượt đã quá 60 giây.";
  } else if (result.reason === "resign") {
    reasonLine = "Đối phương đã đầu hàng.";
  } else if (result.reason === "leave") {
    reasonLine = "Đối phương đã rời phòng.";
  }
  game.finish(session.threadId);
  return sendBoard(api, event, session, "⚔️ KẾT THÚC VÁN CARO", [
    title,
    reasonLine,
    ...scoreLines,
    "Gõ !caro solo hoặc !caro pvp để chơi ván mới."
  ]);
}

function scheduleTurn(session, context) {
  if (!session || session.status !== "active") return;
  game.watchTurn(session.threadId, async ({ player, symbol }) => {
    const timeoutResult = game.resign(session.threadId, player.uid);
    if (!timeoutResult.ok) return;
    timeoutResult.reason = "timeout";
    await settleGame({ ...context, result: timeoutResult });
  });
}

async function afterAcceptedMove({ api, event, Users }, result) {
  let finalResult = result;
  const session = result.session;

  if (!finalResult.finished && session.mode === "solo") {
    const current = session.players[session.turnSymbol];
    if (current?.kind === "bot") {
      finalResult = game.botMove(session.threadId);
    }
  }

  if (finalResult.finished) {
    return settleGame({ api, event, Users, result: finalResult });
  }

  const latest = game.get(session.threadId);
  await sendBoard(api, event, latest, "⚔️ CẬP NHẬT BÀN CỜ CARO", [
    "✅ Đã ghi nhận nước đi."
  ]);
  scheduleTurn(latest, { api, event, Users });
}

async function joinRoom({ api, event, Users, Threads }) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return;
  if (!await isGameEnabled(Threads, threadId)) {
    return send(api, event, "🚫 Game Caro đã được Admin tắt trong nhóm này.");
  }

  const result = game.join(threadId, uid, event?.data?.dName || event?.data?.name || "Người chơi");
  if (!result.ok) {
    const messages = {
      NO_GAME: "⚠️ Chưa có phòng Caro. Gõ !caro pvp để tạo phòng.",
      NOT_WAITING: "⚠️ Phòng Caro không còn chờ người tham gia.",
      OWNER_CANNOT_JOIN: "⚠️ Bạn là chủ phòng; hãy chờ người chơi khác tham gia.",
      FULL: "⚠️ Phòng Caro đã đủ 2 người."
    };
    return send(api, event, messages[result.code] || "⚠️ Không thể tham gia phòng Caro.");
  }

  const session = result.session;
  await sendBoard(api, event, session, "⚔️ BẮT ĐẦU VÁN CARO PvP", [
    `✅ ${result.player.name} đã vào phòng và cầm quân ${result.player === session.players.X ? "X" : "O"}.`,
    "X luôn đi trước, O đi sau."
  ]);
  scheduleTurn(session, { api, event, Users });
}

async function handleSpecial({ api, event, Users }, action) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const session = game.get(threadId);
  if (!session) return false;

  if (action === "lose") {
    const result = game.resign(threadId, uid);
    if (!result.ok) {
      if (result.code === "NOT_PLAYER") return false;
      return send(api, event, "⚠️ Không có ván Caro đang chạy.");
    }
    return settleGame({ api, event, Users, result });
  }

  if (action === "leave") {
    const result = game.leave(threadId, uid);
    if (!result.ok) {
      if (result.code === "NOT_PLAYER") return false;
      return send(api, event, "⚠️ Bạn không ở trong phòng Caro này.");
    }
    if (result.cancelled) {
      game.finish(threadId);
      return send(api, event, "👋 Bạn đã rời phòng. Ván Caro đã được hủy, không tính thắng/thua.");
    }
    result.reason = "leave";
    return settleGame({ api, event, Users, result });
  }

  if (action === "stop") {
    if (session.ownerId !== uid && !isAdmin(uid)) return send(api, event, "⛔ Chỉ chủ phòng hoặc Admin mới được hủy ván.");
    game.stop(threadId);
    game.finish(threadId);
    return send(api, event, "🛑 Đã hủy ván Caro. Không cộng/trừ sao.");
  }
  return false;
}

async function handleMove({ api, event, Users }, text) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const session = game.get(threadId);
  if (!session || session.status !== "active") return false;

  const isPlayer = Object.values(session.players).some(player =>
    player?.kind === "human" && player.uid === uid
  );
  if (!isPlayer) return false;

  const result = game.move(threadId, uid, Number(text));
  if (!result.ok) {
    const messages = {
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      OUT_OF_RANGE: "⚠️ Ô không hợp lệ. Hãy nhập số từ 001 đến 256.",
      OCCUPIED: "♻️ Ô này đã có quân. Hãy chọn ô khác.",
      NO_GAME: "⚠️ Ván Caro đã kết thúc.",
      NOT_PLAYER: "⚠️ Bạn không tham gia ván Caro này."
    };
    return send(api, event, messages[result.code] || "⚠️ Không thể đánh ô này.");
  }

  return afterAcceptedMove({ api, event, Users }, result);
}

async function handleIncoming(context = {}) {
  const { event, isSelf, Threads } = context;
  if (isSelf) return;
  const content = String(event?.data?.content || "").trim();
  if (!content) return;
  const prefix = global.config?.prefix || "/";
  if (content.startsWith(prefix)) return;

  const lower = content.toLowerCase();
  const threadId = String(event?.threadId || "");
  if (!threadId) return;

  if (lower === "join caro") return joinRoom(context);
  if (["lose", "leave", "stop"].includes(lower)) return handleSpecial(context, lower);
  if (!/^\d{1,3}$/.test(lower)) return;

  if (!await isGameEnabled(Threads, threadId)) return;
  return handleMove(context, lower);
}

async function leaderboard(Users, mode = "all", month = null) {
  if (!Users?.getAll) return [];
  const rows = Users.getAll().map(row => {
    const caro = normalizeCaro(row?.data?.caro);
    let stats;
    if (month) {
      const monthStats = caro.months[month] || { solo: EMPTY_STATS(), pvp: EMPTY_STATS() };
      if (mode === "all") {
        const solo = normalizeModeStats(monthStats.solo);
        const pvp = normalizeModeStats(monthStats.pvp);
        stats = {
          points: solo.points + pvp.points,
          wins: solo.wins + pvp.wins,
          losses: solo.losses + pvp.losses,
          draws: solo.draws + pvp.draws,
          games: solo.games + pvp.games
        };
      } else {
        stats = normalizeModeStats(monthStats[mode]);
      }
    } else if (mode === "all") {
      const solo = normalizeModeStats(caro.solo);
      const pvp = normalizeModeStats(caro.pvp);
      stats = {
        points: caro.stars,
        wins: solo.wins + pvp.wins,
        losses: solo.losses + pvp.losses,
        draws: solo.draws + pvp.draws,
        games: solo.games + pvp.games
      };
    } else {
      stats = normalizeModeStats(caro[mode]);
    }

    return {
      uid: String(row.userId || ""),
      name: caro.name || String(row.userId || "Người chơi"),
      ...stats,
      rankingPoints: month || mode !== "all" ? stats.points : caro.stars
    };
  }).filter(row => row.uid && row.games > 0);

  return rows.sort((a, b) =>
    b.rankingPoints - a.rankingPoints || b.wins - a.wins || a.losses - b.losses
  ).slice(0, 10);
}

async function resetPlayer(Users, uid, mode) {
  const record = await Users.getData(String(uid));
  const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
  if (mode === "all") {
    delete data.caro;
  } else {
    const caro = normalizeCaro(data.caro);
    caro[mode] = EMPTY_STATS();
    for (const [month, stats] of Object.entries(caro.months)) {
      delete stats[mode];
      if (!stats.solo && !stats.pvp) delete caro.months[month];
    }
    if (!caro.solo.games && !caro.pvp.games && !caro.stars) delete data.caro;
    else data.caro = caro;
  }
  await Users.setData(String(uid), data);
}

async function resetScores(Users, mode, allUsers, requesterUid) {
  const userIds = allUsers
    ? (Users?.getAll?.() || []).map(row => String(row.userId)).filter(Boolean)
    : [String(requesterUid)];
  for (const uid of userIds) await resetPlayer(Users, uid, mode);
  return userIds.length;
}

module.exports.run = async function ({ args = [], api, event, Users, Threads }) {
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  const prefix = global.config?.prefix || "/";
  if (!uid || !threadId) return;

  const action = String(args[0] || "help").toLowerCase();
  const rest = args.slice(1).map(value => String(value).toLowerCase());

  if (action === "help") return send(api, event, help(prefix));

  if (action === "on" || action === "off") {
    if (!isAdmin(uid)) return send(api, event, "⛔ Chỉ Admin bot mới được bật/tắt Game Caro.");
    try {
      await setGameEnabled(Threads, threadId, action === "on");
      if (action === "off" && game.get(threadId)) {
        game.stop(threadId);
        game.finish(threadId);
      }
      return send(api, event, action === "on"
        ? "✅ Đã bật Game Caro trong nhóm hiện tại."
        : "🚫 Đã tắt Game Caro trong nhóm hiện tại. Ván đang chạy (nếu có) đã được hủy, không tính sao.");
    } catch (error) {
      return send(api, event, "❌ Không thể lưu cài đặt Caro: " + error.message);
    }
  }

  if (action === "bxh" || action === "rank") {
    const mode = rest.includes("solo") ? "solo" : rest.includes("pvp") ? "pvp" : "all";
    const monthToken = rest.find(value => /^\d{4}-\d{2}$/.test(value) || ["thang", "tháng", "month"].includes(value));
    const month = monthToken
      ? (/^\d{4}-\d{2}$/.test(monthToken) ? monthToken : currentMonthKey())
      : null;
    const rows = await leaderboard(Users, mode, month);
    if (!rows.length) {
      return send(api, event, `🏆 Chưa có dữ liệu BXH Caro ${mode.toUpperCase()}${month ? " tháng " + month : ""}.`);
    }
    const metric = mode === "all" && !month ? "sao" : "điểm";
    const lines = rows.map((row, index) =>
      `${index + 1}. ${row.name} — ${row.rankingPoints >= 0 ? "+" : ""}${row.rankingPoints} ${metric} | ${row.wins} thắng • ${row.losses} thua • ${row.draws} hòa`
    );
    return send(api, event, [
      `🏆 BẢNG XẾP HẠNG CARO ${mode.toUpperCase()}${month ? " • " + month : ""}`,
      "",
      ...lines,
      "",
      "⭐ Thắng +2 sao, thua -1 sao (số sao không xuống dưới 0)."
    ].join("\n"));
  }

  if (action === "reset") {
    if (!isAdmin(uid)) return send(api, event, "⛔ Chỉ Admin bot mới được reset BXH Caro.");
    const mode = rest.includes("solo") ? "solo" : rest.includes("pvp") ? "pvp" : "all";
    const allUsers = rest.includes("all");
    const count = await resetScores(Users, mode, allUsers, uid);
    return send(api, event, `✅ Đã reset ${mode === "all" ? "toàn bộ" : mode.toUpperCase()} Caro của ${count} người dùng.${mode !== "all" ? " Số sao tổng vẫn được giữ nguyên." : ""}`);
  }

  if (action === "join") return joinRoom({ api, event, Users, Threads });

  if (action === "board" || action === "status") {
    const session = game.get(threadId);
    if (!session) return send(api, event, "⚠️ Nhóm hiện không có ván Caro.");
    return sendBoard(api, event, session, "⚔️ BÀN CỜ CARO HIỆN TẠI");
  }

  if (action === "lose" || action === "leave" || action === "stop") {
    return handleSpecial({ api, event, Users }, action);
  }

  if (!await isGameEnabled(Threads, threadId)) {
    return send(api, event, "🚫 Game Caro đã được Admin tắt trong nhóm này.");
  }

  if (action === "solo" || action === "pvp") {
    const noitu = require("../../core/runtime/services/games/noituService");
    const noituQuick = require("../../core/runtime/services/games/noituQuickService");
    const noituRoom = require("../../core/runtime/services/games/noituRoomService");
    const ghepChu = require("../../core/runtime/services/games/ghepchuService");
    if (noitu.get(threadId)?.status === "active" || noituQuick.get(threadId)?.status === "active" ||
        noituRoom.get(threadId) || ghepChu.isBusy(threadId)) {
      return send(api, event, "⚠️ Nhóm đang có game Nối Từ/Ghép Chữ. Hãy kết thúc game hiện tại trước khi mở Caro.");
    }
  }

  if (action === "solo") {
    const symbol = rest.includes("o") ? "O" : "X";
    const order = rest.includes("sau") ? "sau" : rest.includes("truoc") || rest.includes("trước") ? "truoc" : null;
    const humanFirst = order ? order === "truoc" : symbol === "X";
    const result = game.startSolo(threadId, {
      uid,
      name: event?.data?.dName || event?.data?.name || "Người chơi",
      symbol,
      humanFirst
    });
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Caro. Gõ board để xem hoặc stop để hủy.");

    let session = result.session;
    let openingLine = `✅ Bạn cầm quân ${symbol}; ${humanFirst ? "bạn đi trước" : "Bot AI đi trước"}.`;
    if (!humanFirst) {
      const botResult = game.botMove(threadId);
      if (botResult.finished) return settleGame({ api, event, Users, result: botResult });
      session = game.get(threadId);
      openingLine += `\n🤖 Bot AI đã đánh ô ${botResult.cell}.`;
    }
    await sendBoard(api, event, session, "⚔️ BẮT ĐẦU CARO SOLO", [openingLine]);
    scheduleTurn(session, { api, event, Users });
    return;
  }

  if (action === "pvp") {
    const symbol = rest.includes("o") ? "O" : "X";
    const result = game.startPvp(threadId, {
      uid,
      name: event?.data?.dName || event?.data?.name || "Người tạo phòng",
      symbol
    });
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Caro. Gõ board để xem hoặc stop để hủy.");
    const session = result.session;
    const guestSymbol = symbol === "X" ? "O" : "X";
    game.watchLobby(threadId, async () => {
      game.finish(threadId);
      await send(api, event, "⌛ Phòng Caro đã tự hủy vì 5 phút không có người tham gia.");
    });
    await sendBoard(api, event, session, "⚔️ ĐÃ TẠO PHÒNG CARO PvP", [
      `👤 ${session.players[symbol].name}: quân ${symbol}`,
      `🕹️ Đang chờ người chơi thứ hai (quân ${guestSymbol}).`,
      "👉 Người khác gõ join caro hoặc !caro join để tham gia.",
      "⏳ Phòng tự hủy sau 5 phút nếu không có người tham gia."
    ]);
    return;
  }

  return send(api, event, help(prefix));
};

module.exports.handleIncoming = handleIncoming;
module.exports._test = {
  normalizeCaro,
  renderBoard,
  boardCaption,
  sendBoard,
  getBoardRecallTargets,
  rememberBoardResponse,
  recallBoardMessages,
  recallPreviousBoard,
  sendBoardReplacement,
  enqueueBoardUpdate,
  leaderboard,
  updateCaroStats,
  help,
  currentMonthKey
};
