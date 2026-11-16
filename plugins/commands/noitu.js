"use strict";

const game = require("../../core/runtime/services/games/noituService");
const fs = require("fs");
const { renderCanvas } = require("../../core/canvas/workerRender");
const ghepChu = require("../../core/runtime/services/games/ghepchuService");
const { getRequesterProfile } = require("../../core/runtime/requesterProfile");
const botVersion = require("../../package.json").version;
const ghepChuTimers = new Map();

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
    "➜ join <mã> : Vào phòng chờ (Ví dụ: join A1B2)",
    "➜ start : Bắt đầu ván (Chủ phòng, hơn 2 người)",
    "➜ stop / leave / lose / cancel / thua : Dừng ván hoặc rời phòng",
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
  const raw = event?.data?.content;
  return typeof raw === "string"
    ? raw.trim()
    : typeof raw?.title === "string" ? raw.title.trim() : "";
}

async function handleGhepChuText({ api, event, eventType, isSelf = false }) {
  if ((eventType && eventType !== "message") || isSelf || event?.isSelf) return false;
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

  scheduleGhepChuExpiry(api, event, threadId);
  await sendGhepChuCard(api, event, result.session, `✅ Chính xác: ${result.completedAnswer}! +${result.points} điểm.`);
  return true;
}

async function handleNoiTuText({ api, event, eventType, isSelf = false }) {
  if ((eventType && eventType !== "message") || isSelf || event?.isSelf) return false;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (!threadId || !uid) return false;
  const session = game.get(threadId);
  // Only enrolled players are captured; everyone else keeps normal chat.
  if (!session || session.status !== "active" || !session.players?.has(uid)) return false;

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
    await send(api, event, "⏭️ Đã bỏ lượt. " + currentPlayerLine(game.get(threadId)));
    return true;
  }

  const result = game.play(threadId, uid, content);
  if (!result.ok) {
    if (result.code === "NOT_TURN") {
      const current = game.get(threadId)?.players?.get(result.currentUid);
      await send(api, event, "⏳ Đang đến lượt " + (current?.name || "người chơi khác") + ". Chờ chút nhé!");
    } else if (result.code === "WRONG_LINK") {
      const needed = session.currentPhrase?.display?.trim().split(/\\s+/).at(-1) || result.expected;
      await send(api, event, "❌ Chưa nối đúng. Cụm từ cần bắt đầu bằng: " + needed + ".");
    } else if (result.code === "DUPLICATE") {
      await send(api, event, "🔁 Cụm từ này đã được dùng rồi. Nghĩ cụm khác nhé!");
    } else if (result.code === "INVALID_PHRASE") {
      await send(api, event, "💬 Hãy trả lời bằng một cụm từ tiếng Việt gồm 2–4 tiếng.");
    }
    return true;
  }

  const nextName = result.nextPlayer?.name || "người chơi tiếp theo";
  await send(api, event, "✅ " + result.phrase.display + " · +1 điểm. Đến lượt " + nextName + "!");
  return true;
}

async function handleActiveGameText(context) {
  if (await handleGhepChuText(context)) return true;
  if (await handleNoiTuText(context)) return true;
  return false;
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
  const action = String(args[0] || "").trim().toLowerCase();
  if (!action || action === "help") return sendGuide(api, event, prefix);

  if (action === "gc") return startGhepChu({ api, event });
  if (action === "skip" && ghepChu.get(threadId)?.status === "active") return handleGhepChuText({ api, event: { ...event, data: { ...event.data, content: "skip" } } });
  if (action === "start" || action === "go") {
    const caro = require("../../core/runtime/services/games/caroService");
    if (ghepChu.get(threadId)?.status === "active") return send(api, event, "⚠️ Nhóm đang có ván Ghép Chữ. Hãy dừng ván đó trước khi mở Nối Từ.");
    if (caro.get(threadId)) return send(api, event, "⚠️ Nhóm đang có ván Caro. Hãy kết thúc ván đó trước khi mở Nối Từ.");
    const name = String(event?.data?.dName || event?.data?.name || "Người chơi");
    const result = game.start(threadId, uid, name);
    if (!result.ok) return send(api, event, "⚠️ Nhóm đang có ván Nối Từ. Gõ join để vào lượt.");
    return send(api, event, "🔗 ĐÃ BẮT ĐẦU GAME NỐI TỪ\n\n🧩 Từ mở màn: " +
      result.session.currentPhrase.display + "\n👥 Người chơi: 1\n👉 Chủ ván nhập cụm từ bắt đầu bằng tiếng cuối của từ mở màn." +
      "\n📌 Gõ " + prefix + "nt join để những người khác tham gia.");
  }

  if (action === "join") {
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
    const rows = await leaderboard(Users);
    if (!rows.length) return send(api, event, "🏆 Chưa có dữ liệu xếp hạng Nối Từ.");
    const lines = rows.map((row, index) => (index + 1) + ". UID " + row.uid + " — " + row.points + " điểm");
    return send(api, event, "🏆 BẢNG XẾP HẠNG NỐI TỪ\n" + lines.join("\n"));
  }
  return sendGuide(api, event, prefix);
};
module.exports.handleEvent = handleActiveGameText;
module.exports._test = { help, leaderboard, sendGuide, ghepChuCardData, startGhepChu, handleGhepChuText, handleNoiTuText, handleActiveGameText, getPlainMessage };