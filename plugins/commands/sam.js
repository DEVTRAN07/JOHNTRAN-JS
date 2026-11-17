"use strict";

const fs = require("node:fs");
const { ThreadType } = require("zalo-client");
const { withRequesterMention } = require("../../core/mentions");
const { renderCanvas } = require("../../core/canvas/workerRender");
const game = require("../../core/runtime/services/games/samService");
const engine = require("../../core/games/samEngine");
const wallet = require("./tlmn")._test;

const locks = new Map();
const cleanupTimers = new Map();
const messageCards = new Map();

module.exports.config = {
  name: "sam",
  aliases: ["saml", "samloc"],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Sâm Lốc 2–4 người, 10 lá mỗi người, báo Sâm và lủng Sâm",
  category: "Game",
  usage: "sam [go|join <mã>|start|baosam|pass|leave|stop|info|help]",
  cooldowns: 0,
  dependencies: {}
};

function withRoomLock(threadId, operation) {
  const key = String(threadId || "");
  if (!key) return Promise.resolve().then(operation);
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  return current.finally(() => {
    if (locks.get(key) === current) locks.delete(key);
  });
}

function getRawApi(api) {
  if (!api || typeof api.sendMessage !== "function" ||
      !Object.prototype.hasOwnProperty.call(api, "sendMessage")) return api;
  const parent = Object.getPrototypeOf(api);
  return parent && typeof parent.sendMessage === "function" ? parent : api;
}

function sendText(api, event, message) {
  return api.sendMessage(
    withRequesterMention(event, { msg: String(message || "") }),
    event.threadId, event.type
  );
}

function responseTargets(response) {
  const items = [
    ...(response?.message ? [response.message] : []),
    ...(Array.isArray(response?.attachment) ? response.attachment : [])
  ];
  const unique = new Map();
  for (const item of items) {
    const msgId = item?.msgId;
    const cliMsgId = item?.cliMsgId;
    if ((typeof msgId !== "string" && typeof msgId !== "number") ||
        (typeof cliMsgId !== "string" && typeof cliMsgId !== "number")) continue;
    unique.set(String(msgId) + ":" + String(cliMsgId), { msgId, cliMsgId });
  }
  return [...unique.values()];
}

async function recallMessages(api, destination, targets) {
  const rawApi = getRawApi(api);
  const failed = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    try {
      if (typeof rawApi?.undo !== "function") throw new Error("API thu hồi tin nhắn không khả dụng");
      const result = await rawApi.undo(
        { msgId: target.msgId, cliMsgId: target.cliMsgId },
        String(destination.threadId), destination.type
      );
      if (result === false || result?.success === false) throw new Error("Zalo từ chối thu hồi card cũ");
    } catch (error) {
      failed.push(target);
      console.warn("[SAM_RECALL]", error?.message || error);
    }
  }
  return failed;
}

async function sendReplacement(api, key, destination, makeSend) {
  const rawApi = getRawApi(api);
  const response = await makeSend(rawApi);
  const next = responseTargets(response);
  if (!next.length) return response;
  const previous = messageCards.get(key) || [];
  const failed = await recallMessages(rawApi, destination, previous);
  messageCards.set(key, [...next, ...failed]);
  return response;
}

function privateDestination(api, uid) {
  const target = String(uid || "");
  const own = String(api?.getOwnId?.() || "");
  if (own && target === own) {
    const myDocuments = String(api?.getContext?.()?.loginInfo?.send2me_id || "").trim();
    if (!myDocuments) throw new Error("Không lấy được My Documents của tài khoản bot.");
    return { threadId: myDocuments, type: ThreadType.User, myDocuments: true };
  }
  if (!target) throw new Error("Thiếu UID người nhận bài Sâm.");
  return { threadId: target, type: ThreadType.User, myDocuments: false };
}

async function sendPrivateHand(api, room, player, hand, turn = false) {
  let destination;
  try { destination = privateDestination(api, player.uid); }
  catch (error) {
    console.error("[SAM_PRIVATE_DEST]", error?.message || error);
    return false;
  }
  const suitNames = { b: "Bích", ch: "Chuồn", r: "Rô", c: "Cơ" };
  const suitCodes = { b: "b", ch: "ch", r: "r", c: "c" };
  const codes = hand.map(card =>
    String(engine.RANK_LABEL[card.rank]).toLowerCase() + suitCodes[card.suit]
  ).join("  ");
  const names = hand.map(card =>
    String(engine.RANK_LABEL[card.rank]) + suitNames[card.suit]
  ).join(", ");
  const message = [
    "🃏 BÀI SÂM LỐC CỦA BẠN (" + hand.length + " lá)",
    destination.myDocuments ? "📁 Bài được lưu vào My Documents." : "",
    "",
    codes,
    "(" + names + ")",
    "",
    turn ? "🎯 ĐẾN LƯỢT BẠN." : "🔒 Bài này chỉ bạn nhìn thấy.",
    "",
    "Lệnh: chon 1,2 • doi 7 • sam 9 • tuquy 5 • sanh 345 • pass",
    "Báo Sâm trước nước đầu tiên: baosam (người báo được đánh trước)"
  ].filter(Boolean).join("\n");
  const key = "sam-hand:" + room.id + ":" + player.uid;
  const rawApi = getRawApi(api);
  let imagePath = null;
  try {
    imagePath = await renderCanvas("sam", {
      view: "hand",
      room: { id: room.id },
      player: { uid: player.uid, name: player.name },
      hand: hand.map(card => ({ ...card })),
      isTurn: Boolean(turn)
    }, { timeout: 20000, poolSize: 1 });
    const response = await sendReplacement(api, key, destination, sender =>
      sender.sendMessage({ msg: message, attachments: [imagePath] },
        destination.threadId, destination.type)
    );
    return Boolean(response);
  } catch (error) {
    console.error("[SAM_CANVAS_HAND]", error?.message || error);
    try {
      const response = await sendReplacement(api, key, destination, sender =>
        sender.sendMessage({ msg: message }, destination.threadId, destination.type)
      );
      return Boolean(response);
    } catch (sendError) {
      console.error("[SAM_PRIVATE_HAND]", sendError?.message || sendError);
      return false;
    }
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
}

function roomCaption(room, notice = "") {
  const lines = [
    "🃏 SÂM LỐC  •  JOHNTRAN",
    "Bàn #" + room.id + "  |  " + (room.status === "waiting" ? "ĐANG CHỜ" : room.status === "playing" ? "ĐANG CHƠI" : "KẾT THÚC"),
    "Cược: " + Number(room.bet || 300).toLocaleString("vi-VN") + " xu/người",
    "Người chơi: " + room.players.map((player, index) => {
      const turn = player.uid === room.turnUid ? " ▶" : "";
      const count = player.handCount == null ? "chờ" : player.handCount + " lá";
      const place = player.place > 0 ? " • hạng " + player.place : "";
      return (index + 1) + ". " + player.name + " — " + count + place + turn;
    }).join("\n")
  ];
  const oneCardPlayers = room.players.filter(player => player.handCount === 1);
  if (oneCardPlayers.length) {
    lines.push("", "⚠️ BÁO 1 LÁ: " + oneCardPlayers.map(player => player.name).join(", ") +
      " chỉ còn 1 lá. Cả bàn cần chú ý chặn.");
  }
  if (room.lastPlay?.cards?.length) {
    lines.push("", "🂠 " + room.lastPlay.name + " đánh: " + engine.formatCards(room.lastPlay.cards));
  }
  if (room.samStatus === "called") lines.push("🔥 " + (room.players.find(p => p.uid === room.samCallerUid)?.name || "Người chơi") + " ĐANG BÁO SÂM");
  if (room.samStatus === "failed") {
    const caller = room.players.find(p => p.uid === room.samCallerUid)?.name || "Người báo Sâm";
    const blocker = room.players.find(p => p.uid === room.samBlockedByUid)?.name || "Đối thủ";
    lines.push("💥 LỦNG SÂM: " + caller + " bị " + blocker + " chặn!");
  }
  if (notice) lines.push("", notice);
  if (room.status === "waiting") lines.push("", "Vào bàn: !sam go hoặc !sam join " + room.id, "Chủ bàn gõ !sam start khi đủ người.");
  if (room.status === "playing") lines.push("", "Lượt hiện tại: " +
    (room.players.find(p => p.uid === room.turnUid)?.name || "Người chơi"),
  "Nhập mã lá, chon 1,2, pass hoặc baosam.");
  return lines.join("\n");
}

async function sendGroupRoom(api, event, room, notice = "") {
  const textCaption = roomCaption(room, notice);
  const lastPlay = room.lastPlay?.cards?.length
    ? engine.formatCards(room.lastPlay.cards) : "Chưa có bộ bài nào được đánh";
  const players = room.players.map(item => {
    const turn = item.uid === room.turnUid ? "  ◀ ĐẾN LƯỢT" : "";
    const count = item.handCount == null ? "Đang chờ" : item.handCount + " lá";
    return item.name + " • " + count + turn;
  });
  const sections = [
    { title: "NGƯỜI CHƠI", lines: players },
    { title: "TRÊN BÀN", lines: [lastPlay] }
  ];
  if (room.samStatus) {
    const caller = room.players.find(p => p.uid === room.samCallerUid)?.name || "Người chơi";
    sections.push({
      title: "BÁO SÂM",
      lines: [room.samStatus === "called" ? caller + " đã báo Sâm" :
        room.samStatus === "success" ? caller + " báo Sâm thành công" :
          caller + " đã bị chặn — lủng Sâm"]
    });
  }
  const destination = { threadId: String(event.threadId), type: event.type };
  const key = "sam-group:" + room.threadId;
  let imagePath = null;
  try {
    imagePath = await renderCanvas("card", {
      chip: "JOHNTRAN  /  CARD GAME",
      brand: "SÂM LỐC",
      title: "BÀN SÂM LỐC #" + room.id,
      subtitle: room.status === "waiting" ? "Phòng chờ  •  " + room.playerCount + "/4 người" :
        "Đang chơi  •  " + room.playerCount + " người",
      sections,
      footer: "Lẻ • Đôi • Sám • Tứ quý • Sảnh • Báo Sâm"
    }, { timeout: 20000, poolSize: 1 });
    return await sendReplacement(api, key, destination, sender =>
      sender.sendMessage(withRequesterMention(event, {
        msg: textCaption, attachments: [imagePath]
      }), destination.threadId, destination.type)
    );
  } catch (error) {
    console.error("[SAM_CANVAS]", error?.message || error);
    return sendReplacement(api, key, destination, sender =>
      sender.sendMessage(withRequesterMention(event, { msg: textCaption }),
        destination.threadId, destination.type)
    );
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
}

async function recallRoomCards(api, room) {
  if (!room) return 0;
  let failures = 0;
  const rawApi = getRawApi(api);
  const groupKey = "sam-group:" + room.threadId;
  const groupDestination = { threadId: String(room.threadId), type: ThreadType.Group };
  const failedGroup = await recallMessages(rawApi, groupDestination,
    messageCards.get(groupKey) || []);
  if (failedGroup.length) {
    messageCards.set(groupKey, failedGroup);
    failures += failedGroup.length;
  } else messageCards.delete(groupKey);

  for (const player of room.players || []) {
    const key = "sam-hand:" + room.id + ":" + player.uid;
    const targets = messageCards.get(key) || [];
    if (!targets.length) continue;
    let destination;
    try {
      destination = privateDestination(api, player.uid);
    } catch (error) {
      failures += targets.length;
      continue;
    }
    const failed = await recallMessages(rawApi, destination, targets);
    if (failed.length) {
      messageCards.set(key, failed);
      failures += failed.length;
    } else messageCards.delete(key);
  }
  return failures;
}

async function recallPrivateHand(api, room, uid) {
  const key = "sam-hand:" + room.id + ":" + String(uid);
  const targets = messageCards.get(key) || [];
  if (!targets.length) return 0;
  const destination = privateDestination(api, uid);
  const failed = await recallMessages(api, destination, targets);
  if (failed.length) {
    messageCards.set(key, failed);
    return failed.length;
  }
  messageCards.delete(key);
  return 0;
}

async function persistRoom(Threads, threadId) {
  if (!Threads?.getData || !Threads?.setData) return true;
  try {
    const record = await Threads.getData(String(threadId));
    const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
    const room = game.get(String(threadId));
    if (room && room.winnerUid) data.sam_previous_winner = String(room.winnerUid);
    if (room && room.status !== "cancelled" &&
        (room.status !== "finished" || !room.settled)) data.sam_room = game.serialize(room);
    else delete data.sam_room;
    if (typeof Threads.setDataAndWait === "function") await Threads.setDataAndWait(String(threadId), data);
    else await Threads.setData(String(threadId), data);
    return true;
  } catch (error) {
    console.error("[SAM_PERSIST]", error?.stack || error);
    return false;
  }
}

async function restoreRoom(Threads, threadId) {
  if (game.get(threadId)) return game.get(threadId);
  if (!Threads?.getData) return null;
  try {
    const record = Threads.getCachedData?.(String(threadId)) || await Threads.getData(String(threadId));
    const data = record?.data && typeof record.data === "object" ? record.data : record;
    if (data?.sam_room) return game.restore(data.sam_room);
  } catch (error) {
    console.error("[SAM_RESTORE]", error?.message || error);
  }
  return null;
}

async function hasSavedRoom(Threads, threadId) {
  if (!Threads?.getData) return false;
  try {
    const record = Threads.getCachedData?.(String(threadId)) || await Threads.getData(String(threadId));
    const data = record?.data && typeof record.data === "object" ? record.data : record;
    return Boolean(data?.sam_room);
  } catch { return true; }
}

function gameConflict(threadId) {
  try {
    const tlmn = require("../../core/runtime/services/games/tlmnService");
    if (tlmn.isBusy?.(threadId)) return "Tiến Lên";
  } catch {}
  try {
    if (require("../../core/runtime/services/games/caroService").isBusy?.(threadId)) return "Caro";
  } catch {}
  try {
    const noitu = require("../../core/runtime/services/games/noituService");
    const quick = require("../../core/runtime/services/games/noituQuickService");
    const room = require("../../core/runtime/services/games/noituRoomService");
    const ghepchu = require("../../core/runtime/services/games/ghepchuService");
    if (noitu.get?.(threadId)?.status === "active" || quick.get?.(threadId)?.status === "active" ||
        room.get?.(threadId) || ghepchu.get?.(threadId)?.status === "active") return "Nối Từ/Ghép Chữ";
  } catch {}
  return null;
}

function help(prefix = "!") {
  return [
    "🃏 HƯỚNG DẪN SÂM LỐC",
    "",
    "52 lá • 2–4 người • mỗi người đúng 10 lá.",
    "Thứ tự số: 2 > A > K > Q > J > 10 > ... > 3. Sâm chỉ so số, không so chất.",
    "",
    "🧩 BỘ BÀI",
    "Lẻ • đôi • sám • sảnh liên tiếp từ 3 lá • tứ quý.",
    "Không có sảnh K-A-2, A-2-3 hoặc 2-3-4.",
    "",
    "🔥 BÁO SÂM",
    "Ai hô Sâm trước được quyền đánh đầu. Bị chặn dù chỉ một lần thì đền Sâm.",
    "Đánh hết 10 lá mà không bị chặn: ăn 20 cược từ mỗi nhà.",
    "Không ai báo Sâm: ván đầu người mở đầu ngẫu nhiên; ván sau người thắng ván trước đi đầu nếu còn trong bàn.",
    "",
    "🎮 ĐÁNH BÀI",
    "Theo vòng; phải cùng loại và lớn hơn, hoặc dùng tứ quý chặt heo/tứ quý nhỏ hơn.",
    "Bỏ lượt là bỏ cả vòng; người đánh cuối được mở vòng mới.",
    "Không được đánh 2 làm lá cuối. Khi có người báo 1, người khác phải đánh lá lớn nhất trên tay; đánh nhỏ hơn để người báo 1 thắng sẽ bị phạt theo tổng số lá còn lại × cược.",
    "",
    "✨ TỚI TRẮNG (ăn 20 cược từ mỗi nhà)",
    "Sảnh rồng 10 lá > tứ quý 2 > đồng hoa (10 lá cùng màu) > 3 sám > 5 đôi.",
    "Nếu cùng loại, so lá cao nhất theo số; Sâm không so chất.",
    "",
    "⚔️ CHẶT",
    "Tứ quý chặt 2 và tứ quý nhỏ hơn. Chặt chồng tính 15 cược cho mỗi lần chặt.",
    "",
    "💰 TÍNH TIỀN",
    "Rác còn: 1 cược/lá • thối 2: 15 cược/lá • thối tứ quý: 15 cược/bộ.",
    "Báo Sâm thành công: +20 cược từ mỗi nhà.",
    "LỦNG SÂM / báo Sâm thất bại: người báo đền 20 cược × (số người chơi − 1) cho người chặn.",
    "Tới trắng: +20 cược từ mỗi nhà.",
    "Cóng: 15 cược + tiền thối heo/hàng.",
    "Tứ quý chặt 2: 15 cược/con • chặt tứ quý: 15 cược/bộ • chặt chồng: 15 cược/lần.",
    "",
    "🕹️ LỆNH",
    prefix + "sam go — Mở/tham gia bàn",
    prefix + "sam join <mã> — Vào bàn",
    prefix + "sam cuoc <số> — Đặt cược (mặc định 300)",
    prefix + "sam start — Bắt đầu",
    prefix + "sam baosam — Hô Sâm",
    prefix + "sam info — Xem bàn • sam leave • sam stop • sam help",
    "Đánh: 3b • doi 7 • sam 9 • tuquy 5 • sanh 345 • chon 1,2 • pass",
    "",
    "Xu ảo dùng chung ví với Tiến Lên. Bot ký quỹ trước khi chia bài và tự đối soát sau ván."
  ].join("\n");
}

function scheduleLobbyCleanup(context, room, timeoutMs) {
  if (!room?.threadId) return false;
  return game.watchLobby(room.threadId, async () =>
    withRoomLock(room.threadId, async () => {
      const current = game.get(room.threadId);
      if (!current || current.id !== room.id || current.status !== "waiting") return;
      const refunded = await refundSamWallets(context.Users, current, context.Threads);
      if (!refunded) {
        await persistRoom(context.Threads, current.threadId);
        await sendText(context.api, context.event,
          "⚠️ Bàn Sâm #" + current.id +
          " hết thời gian chờ nhưng khoản cược chưa hoàn an toàn. Dữ liệu được giữ lại để thử lại.");
        scheduleLobbyCleanup(context, current, 60 * 1000);
        return;
      }
      await recallRoomCards(context.api, current);
      game.removeRoom(current.threadId);
      await persistRoom(context.Threads, current.threadId);
      await sendText(context.api, context.event,
        "⌛ Bàn Sâm #" + current.id + " tự hủy do chờ quá lâu. Khoản cược chờ (nếu có) đã được hoàn.");
    }), timeoutMs);
}

async function createOrJoin(context) {
  const { api, event, Users, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const name = event?.data?.dName || event?.data?.name || "Người chơi";
  if (event?.type !== ThreadType.Group) return sendText(api, event, "⚠️ Sâm Lốc chỉ chơi trong nhóm.");
  let current = await restoreRoom(Threads, threadId);
  if (current?.status === "waiting") {
    const joined = game.joinWaiting(threadId, { uid, name });
    if (!joined.ok) return sendText(api, event, "⚠️ Không thể vào bàn Sâm.");
    await persistRoom(Threads, threadId);
    return sendGroupRoom(api, event, joined.room,
      joined.alreadyJoined ? "✅ Bạn đã có trong bàn." : "✅ " + name + " đã tham gia.");
  }
  if (current?.status === "playing") {
    if (current.players.some(item => item.uid === uid)) {
      return sendGroupRoom(api, event, game.snapshot(current), "✅ Bạn đang ở trong ván Sâm này.");
    }
    return sendText(api, event, "⚠️ Nhóm đang có ván Sâm Lốc. Hãy chờ ván hiện tại kết thúc.");
  }
  if (await hasSavedRoom(Threads, threadId)) {
    return sendText(api, event, "⚠️ Nhóm còn dữ liệu Sâm cần khôi phục. Bot giữ nguyên dữ liệu để tránh mất trạng thái ván.");
  }
  const conflict = gameConflict(threadId);
  if (conflict) return sendText(api, event, "⚠️ Nhóm đang chơi " + conflict + ". Hãy kết thúc ván đó trước.");
  const savedThread = await Threads.getData(String(threadId)).catch(() => null);
  const previousWinnerUid = String(savedThread?.data?.sam_previous_winner || "");
  const created = game.create(threadId, { uid, name }, { previousWinnerUid });
  if (!created.ok) return sendText(api, event, "⚠️ Nhóm đã có bàn Sâm hoạt động.");
  scheduleLobbyCleanup({ api, event, Users, Threads }, created.state);
  await persistRoom(Threads, threadId);
  await sendGroupRoom(api, event, created.room, "💡 Gõ !sam go để tham gia hoặc !sam start khi đủ người.");
}

async function joinRoom(context, code) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const name = event?.data?.dName || event?.data?.name || "Người chơi";
  await restoreRoom(Threads, threadId);
  if (!/^\d{5}$/.test(String(code || ""))) return sendText(api, event, "⚠️ Mã bàn Sâm phải có 5 chữ số.");
  const joined = game.join(threadId, code, { uid, name });
  if (!joined.ok) {
    const messages = {
      ROOM_NOT_FOUND: "⚠️ Không tìm thấy bàn Sâm.",
      WRONG_GROUP: "⚠️ Mã bàn này thuộc nhóm khác.",
      NOT_WAITING: "⚠️ Bàn đã bắt đầu hoặc đã đóng.",
      FULL: "⚠️ Bàn Sâm đã đủ 4 người."
    };
    return sendText(api, event, messages[joined.code] || "⚠️ Không thể tham gia bàn Sâm.");
  }
  await persistRoom(Threads, threadId);
  await sendGroupRoom(api, event, joined.room,
    joined.alreadyJoined ? "✅ Bạn đã ở trong bàn." : "✅ " + joined.player.name + " đã vào bàn.");
}

async function distributeHands(api, room) {
  const failed = [];
  for (const player of room.players) {
    const ok = await sendPrivateHand(api, room, player, room.hands[player.uid] || [],
      player.uid === room.turnUid);
    if (!ok) failed.push(player.name);
  }
  return failed;
}

async function settleSamWallets(Users, room, Threads) {
  if (room.settled) return { ok: true, alreadySettled: true, rows: room.settlementRows || [] };
  if (!room.settlement || !room.locked || !Array.isArray(room.players)) {
    return { ok: false, code: "MISSING_SETTLEMENT_OR_ESCROW" };
  }
  if (Object.keys(room.lockPending || {}).length) {
    return { ok: false, code: "PENDING_ESCROW_RESERVATION" };
  }
  const requiredLock = 250 * Math.max(100, Math.floor(Number(room.stake) || 300));
  if (!Number.isSafeInteger(requiredLock) ||
      Object.keys(room.locked).length !== room.players.length ||
      room.players.some(player => Number(room.locked[String(player.uid)]) !== requiredLock)) {
    return { ok: false, code: "INSUFFICIENT_ESCROW" };
  }
  const netTotal = Object.values(room.settlement.net).reduce((sum, value) => sum + Number(value), 0);
  if (!Number.isSafeInteger(netTotal) || netTotal !== 0) {
    return { ok: false, code: "NON_ZERO_SUM_SETTLEMENT" };
  }
  const rows = [];
  for (const player of room.players) {
    const uid = String(player.uid);
    const locked = Number(room.locked[uid]);
    const net = Number(room.settlement.net?.[uid]);
    if (!Number.isSafeInteger(locked) || locked < 0 || !Number.isSafeInteger(net) ||
        locked + net < 0) {
      return { ok: false, code: "INVALID_ESCROW", uid };
    }
    const outcome = await wallet.changeWallet(
      Users, uid, locked + net,
      "sam-settle:" + String(room.gameToken || room.id) + ":" + uid,
      { mutateData(data, current) {
        current.games += 1;
        if (uid === String(room.winnerUid)) current.wins += 1;
        else current.losses += 1;
        current.name = String(player.name || uid).slice(0, 40);
        data.tlmn = current;
      }}
    );
    if (!outcome.ok) return { ok: false, code: "WALLET_CREDIT_FAILED", uid };
    rows.push({
      uid, name: player.name, change: net,
      coins: outcome.coins, locked, net
    });
    room.settlementRows = rows.slice();
    await persistRoom(Threads, room.threadId);
  }
  room.locked = {};
  room.settled = true;
  room.settlementError = null;
  await persistRoom(Threads, room.threadId);
  return { ok: true, rows };
}

async function refundSamWallets(Users, room, Threads) {
  if (!room) return true;
  const hasLocked = Object.keys(room.locked || {}).length > 0;
  const hasPending = Object.keys(room.lockPending || {}).length > 0;
  if (!hasLocked && !hasPending) return true;
  const refunded = await wallet.refundRoomWallets(
    Users, room, () => persistRoom(Threads, room.threadId)
  );
  return refunded === true &&
    Object.keys(room.locked || {}).length === 0 &&
    Object.keys(room.lockPending || {}).length === 0;
}

async function finishGame(context, room, notice = "") {
  const { api, event, Threads, Users } = context;
  // Persist the terminal game state before touching wallets. Recovery can
  // safely retry the idempotent per-player settlement after a restart.
  await persistRoom(Threads, room.threadId);
  const settlement = await settleSamWallets(Users, room, Threads);
  if (!settlement.ok) {
    await persistRoom(Threads, room.threadId);
    await sendText(api, event, "⚠️ Chưa thể chốt xu Sâm an toàn (" + settlement.code +
      "). Bot giữ nguyên dữ liệu bàn để tự đối soát, không tự trừ lặp.");
    return false;
  }
  const winner = room.players.find(item => item.uid === room.winnerUid);
  const outcome = room.whiteHand
    ? "✨ ĂN TRẮNG: " + (winner?.name || "Người chơi") + " — " +
      engine.WHITE_HAND_LABEL[room.whiteHand.type] + "."
    : room.samStatus === "success"
      ? "🔥 BÁO SÂM THÀNH CÔNG: " + (winner?.name || "Người chơi") + " đã về nhất."
      : room.samStatus === "failed"
        ? "💥 LỦNG SÂM: người báo Sâm bị " +
          (room.players.find(item => item.uid === room.samBlockedByUid)?.name || "đối thủ") +
          " chặn. Ván kết thúc."
        : "🏆 " + (winner?.name || "Người chơi") + " đã đánh hết 10 lá và về nhất.";
  const results = (room.results || []).map(row =>
    (row.place === 1 ? "👑 " : "• ") + row.place + ". " + row.name + " — còn " + row.cardsLeft + " lá"
  );
  await sendGroupRoom(api, event, game.snapshot(room), [outcome, notice].filter(Boolean).join("\n"));
  await sendText(api, event, [
    "🏁 KẾT QUẢ SÂM LỐC #" + room.id,
    "",
    outcome,
    ...results,
    "",
    "💰 MỨC CƯỢC: " + Number(room.stake || 5000).toLocaleString("vi-VN") + " xu",
    ...(settlement.rows || []).map(row =>
      (row.change >= 0 ? "🟢 +" : "🔴 ") + Math.abs(row.change).toLocaleString("vi-VN") +
      " xu • " + row.name + " • Số dư " + Number(row.coins).toLocaleString("vi-VN")
    ),
    "",
    "👉 Gõ !sam go để mở bàn Sâm mới."
  ].join("\n"));
  await persistRoom(Threads, room.threadId);
  await recallRoomCards(api, room);
  const cleanupRoomId = room.id;
  const cleanup = setTimeout(async () => {
    if (cleanupTimers.get(room.threadId) !== cleanup) return;
    cleanupTimers.delete(room.threadId);
    if (game.get(room.threadId)?.id !== cleanupRoomId) return;
    game.removeRoom(room.threadId);
    await persistRoom(Threads, room.threadId);
  }, 15000);
  cleanup.unref?.();
  cleanupTimers.set(room.threadId, cleanup);
}

async function startRoom(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const room = await restoreRoom(Threads, threadId);
  if (!room || room.status !== "waiting") return sendText(api, event, "⚠️ Không có bàn Sâm đang chờ.");
  if (room.ownerId !== uid) return sendText(api, event, "⛔ Chỉ chủ bàn mới được bắt đầu.");
  if (room.players.length < 2) return sendText(api, event, "⚠️ Cần ít nhất 2 người chơi.");
  const stake = Math.max(100, Math.floor(Number(room.stake) || 300));
  room.stake = stake;
  room.bet = 1000; // Wallet helper validates the base game bet; reservePerPlayer carries the Sâm risk cap.
  room.reservePerPlayer = 250 * stake;
  room.locked ||= {};
  room.lockPending ||= {};
  room.lockTransactionId ||= room.gameToken || room.id;
  const reserved = await wallet.reserveRoomWallets(
    context.Users, room, () => persistRoom(Threads, threadId)
  );
  if (!reserved.ok) {
    return sendText(api, event, reserved.storageError
      ? "⚠️ Không thể giữ cược trong ví. Ván chưa bắt đầu."
      : "💸 " + (reserved.player?.name || "Một người chơi") +
        " không đủ xu. Cần giữ " + (reserved.required || room.bet * (room.players.length - 1)).toLocaleString("vi-VN") +
        " xu để đảm bảo thanh toán thối/chặt.");
  }
  const started = game.start(threadId, uid);
  if (!started.ok) {
    await refundSamWallets(context.Users, room, Threads);
    return sendText(api, event, "⚠️ Không thể bắt đầu bàn Sâm; đã hoàn cược.");
  }
  const state = started.state;
  const failed = await distributeHands(api, state);
  if (failed.length) {
    await recallRoomCards(api, state);
    state.cancelPending = true;
    if (!await persistRoom(Threads, threadId)) {
      return sendText(api, event,
        "⚠️ Không gửi được bài riêng cho " + failed.join(", ") +
        ". Database chưa lưu được yêu cầu hủy; bàn được giữ nguyên để đối soát an toàn.");
    }
    const refunded = await refundSamWallets(context.Users, state, Threads);
    if (!refunded) {
      await persistRoom(Threads, threadId);
      return sendText(api, event,
        "⚠️ Không gửi được bài riêng cho " + failed.join(", ") +
        ". Khoản cược chưa hoàn xong; bàn được giữ để bot tiếp tục đối soát, không mở ván mới.");
    }
    game.stop(threadId, uid);
    game.removeRoom(threadId);
    await persistRoom(Threads, threadId);
    return sendText(api, event,
      "🚫 Không gửi được bài riêng cho " + failed.join(", ") +
      ". Đã hủy ván và hoàn cược để bảo vệ bài. Người chơi hãy mở chat riêng với Bot và nhắn Bot trước.");
  }
  if (started.finished) {
    await finishGame(context, state);
    return;
  }
  await persistRoom(Threads, threadId);
  await sendGroupRoom(api, event, game.snapshot(state), "🎮 Đã chia đúng 10 lá cho mỗi người. " +
    (state.previousWinnerUid && state.players.some(item => item.uid === state.previousWinnerUid)
      ? "Người thắng ván trước được mở đầu." : "Người mở đầu được chọn ngẫu nhiên."));
  scheduleTurn(context, state);
}

async function doPlay(context, input) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const before = game.get(threadId);
  if (!before || before.status !== "playing") return false;
  const action = game.play(threadId, uid, input);
  if (!action.ok) {
    const errors = {
      NO_GAME: "⚠️ Không có ván Sâm đang chơi.",
      NOT_PLAYER: "⚠️ Bạn không ở trong bàn Sâm.",
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      CANNOT_BEAT: "⛔ Bộ bài không chặn được bộ đang nằm trên bàn.",
      INVALID_COMBINATION: "⚠️ Bộ bài không hợp lệ. Dùng lẻ, đôi, sám, tứ quý hoặc sảnh.",
      INVALID_SELECTION: "⚠️ Số lá chọn không hợp lệ.",
      CARD_NOT_IN_HAND: "⚠️ Bạn không có lá bài này."
    };
    await sendText(api, event, errors[action.code] || "⚠️ Không thể đánh bộ bài này.");
    return true;
  }
  if (action.finished) {
    await finishGame(context, action.state, action.samLung
      ? "Người chặn đã làm báo Sâm thất bại." : "");
    return true;
  }
  await persistRoom(Threads, threadId);
  const notice = action.samLung
    ? "💥 " + (before.players.find(item => item.uid === before.samCallerUid)?.name || "Người báo Sâm") +
      " BỊ LỦNG SÂM! " + (before.players.find(item => item.uid === uid)?.name || "Đối thủ") + " đã chặn."
    : (before.players.find(item => item.uid === uid)?.name || "Người chơi") +
      " đánh " + engine.formatCards(action.combo.cards) + ".";
  await sendGroupRoom(api, event, action.room, notice);
  const actor = before.players.find(item => item.uid === uid);
  if (actor) await sendPrivateHand(api, before, actor, before.hands[uid] || [], false);
  const next = before.players.find(item => item.uid === before.turnUid);
  if (next) await sendPrivateHand(api, before, next, before.hands[next.uid] || [], true);
  scheduleTurn(context, before);
  return true;
}

async function doPass(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const action = game.pass(threadId, uid);
  if (!action.ok) {
    const messages = {
      NOT_PLAYER: "⚠️ Bạn không ở trong bàn Sâm.",
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      CANNOT_PASS_ON_LEAD: "⛔ Bạn đang cầm cái, không thể bỏ lượt.",
      LEADER_CANNOT_PASS: "⛔ Người đánh bộ hiện tại không thể tự bỏ lượt."
    };
    await sendText(api, event, messages[action.code] || "⚠️ Không thể bỏ lượt.");
    return true;
  }
  await persistRoom(Threads, threadId);
  await sendGroupRoom(api, event, action.room,
    action.roundCleared ? "🔄 Vòng đã hết người chặn. Người vừa đánh được quyền ra bộ mới." : "⏭️ Người chơi đã bỏ lượt.");
  scheduleTurn(context, action.state);
  return true;
}

async function callSam(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const result = game.callSam(threadId, uid);
  if (!result.ok) {
    const message = result.code === "TOO_LATE"
      ? "⚠️ Chỉ được báo Sâm trước khi có nước bài đầu tiên."
      : result.code === "NOT_PLAYER" ? "⚠️ Bạn không ở trong bàn Sâm." :
        "⚠️ Không thể báo Sâm lúc này.";
    await sendText(api, event, message);
    return true;
  }
  await persistRoom(Threads, threadId);
  const player = result.state.players.find(item => item.uid === uid);
  await sendGroupRoom(api, event, result.room,
    "🔥 " + (player?.name || "Người chơi") +
      " đã BÁO SÂM và giành lượt mở đầu! Đánh hết 10 lá mà không bị chặn để thắng.");
  if (player) await sendPrivateHand(
    api, result.state, player, result.state.hands[uid] || [], result.state.turnUid === uid
  );
  scheduleTurn(context, result.state);
  return true;
}

function scheduleTurn(context, room) {
  if (!room || room.status !== "playing") return false;
  return game.watchTurn(room.threadId, async ({ uid }) =>
    withRoomLock(room.threadId, async () => {
      const current = game.get(room.threadId);
      if (!current || current.status !== "playing" || current.turnUid !== uid) return;
      const action = game.timeoutTurn(room.threadId, uid);
      if (!action.ok) return;
      const synthetic = {
        ...context,
        event: {
          ...context.event,
          threadId: room.threadId,
          type: ThreadType.Group,
          data: { uidFrom: uid, dName: current.players.find(item => item.uid === uid)?.name || "Người chơi" }
        }
      };
      if (action.finished) {
        await finishGame(synthetic, action.state, "⏰ Hết giờ tự đánh một lá.");
        return;
      }
      await persistRoom(context.Threads, room.threadId);
      await sendGroupRoom(context.api, synthetic.event, action.room,
        action.action === "pass" ? "⏰ Hết 60 giây, Bot tự bỏ lượt." :
          "⏰ Hết 60 giây, Bot tự đánh " + engine.formatCards(action.combo.cards) + ".");
      const actor = action.state.players.find(item => item.uid === uid);
      if (actor && action.action === "play") {
        await sendPrivateHand(context.api, action.state, actor, action.state.hands[uid] || [], false);
      }
      const next = action.state.players.find(item => item.uid === action.state.turnUid);
      if (next) await sendPrivateHand(context.api, action.state, next, action.state.hands[next.uid] || [], true);
      scheduleTurn(context, action.state);
    })
  );
}

async function leaveRoom(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const result = game.leave(threadId, uid);
  if (!result.ok) return sendText(api, event, "⚠️ Bạn không có trong bàn Sâm.");
  if (result.cancelled) {
    // Keep the persisted room recoverable while any interrupted reservation is refunded.
    result.state.status = "waiting";
    const refunded = await refundSamWallets(context.Users, result.state, Threads);
    if (!refunded) {
      await persistRoom(Threads, threadId);
      return sendText(api, event,
        "⚠️ Chưa hoàn được khoản cược đang chờ; bàn vẫn được giữ để thử lại, chưa bị xóa.");
    }
    game.removeRoom(threadId);
    await persistRoom(Threads, threadId);
    return sendText(api, event, "🛑 Đã hủy bàn Sâm. Khoản cược chờ (nếu có) đã được hoàn.");
  }
  if (!result.cancelled) await recallPrivateHand(api, result.state, uid).catch(error => {
    console.warn("[SAM_RECALL_PRIVATE]", error?.message || error);
  });
  await persistRoom(Threads, threadId);
  if (result.state.status === "finished") return finishGame(context, result.state, "Người chơi đã rời bàn.");
  await sendGroupRoom(api, event, result.room, "👋 Người chơi đã rời bàn.");
  scheduleTurn(context, result.state);
}

async function runCommand(context) {
  const { args = [], api, event, Threads } = context;
  const action = String(args[0] || "help").toLowerCase();
  const rest = args.slice(1).map(String);
  const prefix = global.config?.prefix || "!";
  const activeRoom = game.get(threadId);
  if (activeRoom?.cancelPending && !["stop", "info", "status", "help"].includes(action)) {
    return sendText(api, event, "⏳ Bàn Sâm đang hoàn cược/đối soát an toàn. Tạm khóa nước đi và thử lại sau.");
  }
  if (action === "help") return sendText(api, event, help(prefix));
  if (action === "go" || action === "open" || action === "create") return createOrJoin(context);
  if (action === "join") return joinRoom(context, rest[0]);
  if (action === "start") return startRoom(context);
  if (action === "baosam" || action === "bao" || action === "xinlang") return callSam(context);
  if (action === "pass" || action === "bo") return doPass(context);
  if (action === "leave") return leaveRoom(context);
  if (action === "stop") {
    const room = await restoreRoom(Threads, event.threadId);
    if (!room) return sendText(api, event, "⚠️ Không có bàn Sâm.");
    // Authorize before touching escrow; a non-owner must never be able to unlock everyone.
    if (room.ownerId !== String(event.data?.uidFrom || "")) {
      return sendText(api, event, "⛔ Chỉ chủ bàn mới được hủy.");
    }
    if (room.status === "finished") {
      if (!room.settled) {
        await finishGame(context, room, "Chủ bàn yêu cầu kết thúc; hệ thống vẫn phải chốt kết quả đã hoàn tất.");
        return;
      }
      await recallRoomCards(api, room);
      game.removeRoom(event.threadId);
      await persistRoom(Threads, event.threadId);
      return sendText(api, event, "ℹ️ Ván Sâm đã được quyết toán, không cần hủy.");
    }
    if (!await refundSamWallets(context.Users, room, Threads)) {
      await persistRoom(Threads, event.threadId);
      return sendText(api, event, "⚠️ Chưa hoàn cược được an toàn; bàn vẫn được giữ để thử lại.");
    }
    const stopped = game.stop(event.threadId, event.data?.uidFrom);
    if (!stopped.ok) return sendText(api, event, "⛔ Chỉ chủ bàn mới được hủy.");
    await recallRoomCards(api, room);
    game.removeRoom(event.threadId);
    await persistRoom(Threads, event.threadId);
    return sendText(api, event, "🛑 Đã hủy bàn Sâm #" + room.id + ". Cược đã được hoàn (nếu có).");
  }
  if (action === "cuoc" || action === "bet") {
    const raw = String(rest[0] || "").toLowerCase().replace(/[$,\s]/g, "");
    const match = raw.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
    const amount = match ? Math.floor(Number(match[1]) * (match[2] === "m" ? 1000000 : match[2] === "k" ? 1000 : 1)) : 0;
    const room = await restoreRoom(Threads, event.threadId);
    if (!room || room.status !== "waiting") return sendText(api, event, "⚠️ Chỉ đổi cược khi bàn đang chờ.");
    if (room.ownerId !== String(event.data?.uidFrom || "")) return sendText(api, event, "⛔ Chỉ chủ bàn được đổi cược.");
    if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1000000) {
      return sendText(api, event, "⚠️ Cược Sâm từ 100 đến 1M xu. Ví dụ: !sam cuoc 500.");
    }
    room.stake = amount;
    await persistRoom(Threads, event.threadId);
    return sendGroupRoom(api, event, game.snapshot(room), "💰 Đã đặt cược Sâm: " + amount.toLocaleString("vi-VN") + " xu/người.");
  }
  if (action === "info" || action === "status") {
    const room = await restoreRoom(Threads, event.threadId);
    return room ? sendGroupRoom(api, event, game.snapshot(room)) : sendText(api, event, "⚠️ Nhóm chưa có bàn Sâm.");
  }
  return sendText(api, event, help(prefix));
}

async function handleIncomingImpl(context = {}) {
  const { api, event, isSelf, Threads } = context;
  if ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true) return false;
  if (event?.type !== ThreadType.Group) return false;
  const content = String(event?.data?.content || "").trim();
  if (!content || content.startsWith(String(global.config?.prefix || "!"))) return false;
  const threadId = String(event?.threadId || "");
  const room = await restoreRoom(Threads, threadId);
  if (!room) return false;
  if (room.cancelPending) {
    await sendText(api, event, "⏳ Bàn Sâm đang hoàn cược/đối soát an toàn; tạm thời chưa nhận nước đi.");
    return true;
  }
  if (room.status === "playing") scheduleTurn(context, room);
  const lower = engine.normalizeText(content);
  if (lower === "start" && room.status === "waiting") {
    await startRoom(context);
    return true;
  }
  if (["leave", "roi ban"].includes(lower)) {
    await leaveRoom(context);
    return true;
  }
  if (["stop", "huy ban"].includes(lower)) {
    await runCommand({ ...context, args: ["stop"] });
    return true;
  }
  if (room.status !== "playing" || !room.hands?.[String(event?.data?.uidFrom || "")]) return false;
  if (["baosam", "bao sam", "xin lang", "xinlang"].includes(lower)) {
    await callSam(context);
    return true;
  }
  if (["pass", "bo", "bo luot", "skip"].includes(lower)) {
    await doPass(context);
    return true;
  }
  const hasCardSyntax =
    /(10|[3-9]|[jqka2])(ch|b|r|c|t)/i.test(lower) ||
    /^(doi|pair|sam|samco|tuquy|tu\s*quy|four|triple|sanh|straight|chon|select|vitri|vi\s*tri)\b/.test(lower);
  if (hasCardSyntax) {
    await doPlay(context, content);
    return true;
  }
  return false;
}

module.exports.run = context => withRoomLock(
  context?.event?.threadId, () => runCommand(context)
);
module.exports.handleIncoming = context => withRoomLock(
  context?.event?.threadId, () => handleIncomingImpl(context)
);
module.exports._test = {
  privateDestination, roomCaption, gameConflict, help, sendPrivateHand,
  recallRoomCards, createOrJoin, joinRoom, startRoom, doPlay, doPass, callSam, runCommand,
  settleSamWallets, refundSamWallets
};


module.exports.onLoad = async function ({ api, Users, Threads } = {}) {
  if (!Threads?.getAll) return;
  for (const record of Threads.getAll() || []) {
    const threadId = String(record?.threadId || record?.id || "");
    if (!threadId) continue;
    const room = await restoreRoom(Threads, threadId);
    if (!room) continue;
    const event = { threadId, type: ThreadType.Group, data: {} };
    const context = { api, Users, Threads, event };

    if (room.status === "waiting") {
      // A crash may happen after a reservation is debited but before start() is persisted.
      const refunded = await withRoomLock(threadId, () =>
        refundSamWallets(Users, room, Threads)
      );
      if (!refunded || !await persistRoom(Threads, threadId)) {
        await sendText(api, event,
          "⚠️ Bàn Sâm #" + room.id + " đang chờ đối soát khoản cược sau khi bot khởi động lại. Bot giữ dữ liệu, không xóa bàn.");
        continue;
      }
      scheduleLobbyCleanup(context, room);
      continue;
    }

    if (room.status === "playing" && room.cancelPending) {
      const refunded = await withRoomLock(threadId, () =>
        refundSamWallets(Users, room, Threads)
      );
      if (!refunded) {
        await persistRoom(Threads, threadId);
        await sendText(api, event,
          "⚠️ Yêu cầu hủy bàn Sâm #" + room.id + " đã được khôi phục nhưng hoàn cược còn chờ. Bot sẽ giữ bàn để đối soát tiếp.");
        continue;
      }
      game.stop(threadId, room.ownerId);
      await recallRoomCards(api, room);
      game.removeRoom(threadId);
      await persistRoom(Threads, threadId);
      await sendText(api, event,
        "🛑 Bot đã khôi phục yêu cầu hủy bàn Sâm #" + room.id + " và hoàn cược.");
      continue;
    }

    if (room.status === "playing") {
      const reconciled = await wallet.reconcilePendingReservations(
        Users, room, () => persistRoom(Threads, threadId)
      );
      const requiredLock = 250 * Math.max(100, Math.floor(Number(room.stake) || 300));
      const escrowValid = reconciled &&
        Object.keys(room.lockPending || {}).length === 0 &&
        Object.keys(room.locked || {}).length === room.players.length &&
        room.players.every(player => Number(room.locked[player.uid]) === requiredLock);
      if (!escrowValid) {
        await persistRoom(Threads, threadId);
        await sendText(api, event,
          "⚠️ Ván Sâm #" + room.id + " đã khôi phục nhưng ký quỹ chưa khớp. Bot giữ nguyên bàn để quản trị viên đối soát, không tự mở lượt hoặc trừ thêm xu.");
        continue;
      }
      const failed = await distributeHands(api, room);
      await persistRoom(Threads, threadId);
      await sendGroupRoom(api, event, game.snapshot(room),
        "🔄 Bot đã khôi phục ván Sâm sau khi khởi động lại." +
        (failed.length ? "\n⚠️ Chưa gửi lại được bài riêng cho: " + failed.join(", ") + "." : ""));
      scheduleTurn(context, room);
      continue;
    }

    if (room.status === "finished" && !room.settled) {
      await withRoomLock(threadId, () => finishGame(context, room,
        "🔄 Bot đã khôi phục và đối soát giao dịch sau khi khởi động lại."));
    }
  }
};
