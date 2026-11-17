"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { ThreadType } = require("zalo-client");
const { renderCanvas } = require("../../core/canvas/workerRender");
const game = require("../../core/runtime/services/games/tlmnService");
const engine = require("../../core/games/tlmnEngine");
const { firstMention, withRequesterMention } = require("../../core/mentions");

const DEFAULT_COINS = 100000;
const MIN_BET = 1000;
const MAX_BET = 10000000;
const groupCards = new Map();
const privateCards = new Map();
const walletLocks = new Map();
const roomSaveLocks = new Map();
const SUIT_HELP = "b = Bích, ch = Chuồn, r = Rô, c = Cơ";

module.exports.config = {
  name: "tlmn",
  aliases: ["tienlen", "tienlenmiennam"],
  version: "1.0.0",
  role: 0,
  author: "JOHNTRAN",
  description: "Tiến Lên Miền Nam 2–4 người, bàn bài riêng và xu ảo",
  category: "Game",
  usage: "tlmn [go|join|leave|cuoc|mode|info|bxh|pay|on|off|nap]",
  cooldowns: 0,
  dependencies: {}
};

function withRoomSaveLock(threadId, operation) {
  const key = String(threadId);
  const previous = roomSaveLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  roomSaveLocks.set(key, current);
  return current.finally(() => {
    if (roomSaveLocks.get(key) === current) roomSaveLocks.delete(key);
  });
}

async function persistRoom(Threads, threadId) {
  if (!Threads?.getData || !Threads?.setData) return false;
  return withRoomSaveLock(threadId, async () => {
    try {
      const record = await Threads.getData(String(threadId));
      const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
      const room = game.get(String(threadId));
      if (room) data.tlmn_room = game.serialize(room);
      else delete data.tlmn_room;

      if (typeof Threads.setDataAndWait === "function") {
        await Threads.setDataAndWait(String(threadId), data);
      } else {
        await Threads.setData(String(threadId), data);
      }
      return true;
    } catch (error) {
      console.error("[TLMN_PERSIST]", error?.stack || error);
      return false;
    }
  });
}

function restoreRoomCards(room) {
  if (!room?.messageCards) return;
  if (Array.isArray(room.messageCards.group) && room.messageCards.group.length) {
    groupCards.set("group:" + room.threadId, room.messageCards.group);
  }
  for (const [uid, cards] of Object.entries(room.messageCards.private || {})) {
    if (Array.isArray(cards) && cards.length) {
      privateCards.set("hand:" + room.id + ":" + uid, cards);
    }
  }
}

function getRawApi(api) {
  if (!api || typeof api.sendMessage !== "function") return api;
  if (!Object.prototype.hasOwnProperty.call(api, "sendMessage")) return api;
  const parent = Object.getPrototypeOf(api);
  return parent && typeof parent.sendMessage === "function" ? parent : api;
}

function sendText(api, event, message) {
  const payload = withRequesterMention(event, { msg: String(message || "") });
  return api.sendMessage(payload, event.threadId, event.type);
}

function recallTargets(response) {
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

async function recallMessages(api, threadId, type, targets) {
  const rawApi = getRawApi(api);
  const pending = Array.isArray(targets) ? targets : [];
  const failed = [];
  for (const target of pending) {
    try {
      if (typeof rawApi?.undo !== "function") throw new Error("API undo không khả dụng");
      await rawApi.undo({ msgId: target.msgId, cliMsgId: target.cliMsgId }, String(threadId), type);
    } catch (error) {
      failed.push(target);
      console.warn("[TLMN_RECALL]", error?.message || error);
    }
  }
  return failed;
}

async function sendReplacement(api, key, threadId, type, makePayload) {
  const rawApi = getRawApi(api);
  const previous = privateCards.get(key) || groupCards.get(key) || [];
  const response = await makePayload(rawApi);
  const next = recallTargets(response);
  if (!next.length) {
    console.warn("[TLMN_CANVAS] Zalo không trả message ID; giữ lại card cũ để không làm mất bàn.");
    return response;
  }
  const failed = await recallMessages(rawApi, threadId, type, previous);
  if (key.startsWith("hand:")) privateCards.set(key, [...next, ...failed]);
  else groupCards.set(key, [...next, ...failed]);

  const room = key.startsWith("hand:")
    ? game.getByCode(key.split(":")[1])
    : game.get(threadId);
  if (room) {
    room.messageCards ||= { group: [], private: {} };
    if (key.startsWith("hand:")) {
      const uid = key.split(":")[2];
      room.messageCards.private[uid] = [...next, ...failed];
    } else {
      room.messageCards.group = [...next, ...failed];
    }
  }
  return response;
}

function forgetCards(key) {
  if (key.startsWith("hand:")) privateCards.delete(key);
  else groupCards.delete(key);
}

async function recallRoomCards(api, room) {
  const rawApi = getRawApi(api);
  const groupKey = "group:" + room.threadId;
  const oldGroup = groupCards.get(groupKey) || room.messageCards?.group || [];
  await recallMessages(rawApi, room.threadId, ThreadType.Group, oldGroup);
  forgetCards(groupKey);
  if (room.messageCards) room.messageCards.group = [];

  for (const item of room.players || []) {
    const key = "hand:" + room.id + ":" + item.uid;
    const targets = privateCards.get(key) || room.messageCards?.private?.[item.uid] || [];
    await recallMessages(rawApi, item.uid, ThreadType.User, targets);
    forgetCards(key);
    if (room.messageCards?.private) delete room.messageCards.private[item.uid];
  }
}

function withWalletLock(uid, operation) {
  const key = String(uid);
  const previous = walletLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  walletLocks.set(key, current);
  return current.finally(() => {
    if (walletLocks.get(key) === current) walletLocks.delete(key);
  });
}

function normalizeWallet(data) {
  const source = data.tlmn && typeof data.tlmn === "object" ? data.tlmn : {};
  const coins = Number(source.coins);
  return {
    ...source,
    coins: Number.isSafeInteger(coins) && coins >= 0 ? coins : DEFAULT_COINS,
    games: Math.max(0, Number(source.games) || 0),
    wins: Math.max(0, Number(source.wins) || 0),
    losses: Math.max(0, Number(source.losses) || 0),
    transactions: Array.isArray(source.transactions) ? source.transactions.slice(-100) : []
  };
}

async function readWallet(Users, uid) {
  return withWalletLock(uid, async () => {
    const record = await Users.getData(String(uid));
    const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
    const hadWallet = data.tlmn && Number.isSafeInteger(Number(data.tlmn.coins));
    const wallet = normalizeWallet(data);
    if (!hadWallet) {
      data.tlmn = wallet;
      await Users.setData(String(uid), data);
    }
    return { ...wallet };
  });
}

async function changeWallet(Users, uid, delta, transactionId, options = {}) {
  return withWalletLock(uid, async () => {
    const record = await Users.getData(String(uid));
    const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
    const wallet = normalizeWallet(data);
    if (wallet.transactions.includes(String(transactionId))) {
      return { ok: true, alreadyApplied: true, coins: wallet.coins };
    }
    const next = wallet.coins + Number(delta);
    if (!Number.isSafeInteger(next) || next < 0) {
      if (options.allowNegative !== true) return { ok: false, code: "INSUFFICIENT_FUNDS", coins: wallet.coins };
    }
    wallet.coins = next;
    wallet.transactions.push(String(transactionId));
    wallet.transactions = wallet.transactions.slice(-100);
    data.tlmn = wallet;
    if (typeof options.mutateData === "function") options.mutateData(data, wallet);
    await Users.setData(String(uid), data);
    return { ok: true, coins: wallet.coins };
  });
}

async function reserveRoomWallets(Users, room, onChange = null) {
  const reserve = room.bet * (room.players.length - 1);
  const reserved = [];
  for (const item of room.players) {
    const wallet = await readWallet(Users, item.uid);
    if (wallet.coins < reserve) {
      for (const uid of reserved) {
        await changeWallet(Users, uid, reserve, "refund:" + room.id + ":" + (room.lockTransactionId || "retry") + ":" + uid);
      }
      room.locked = {};
      room.lockTransactionId = null;
      await onChange?.();
      return { ok: false, player: item, coins: wallet.coins, required: reserve };
    }
    const attempt = room.lockTransactionId || (room.lockTransactionId = String(Date.now()) + ":" + String(Math.random()).slice(2, 8));
    const result = await changeWallet(Users, item.uid, -reserve, "reserve:" + room.id + ":" + attempt + ":" + item.uid);
    if (!result.ok) {
      for (const uid of reserved) {
        await changeWallet(Users, uid, reserve, "refund:" + room.id + ":" + (room.lockTransactionId || "retry") + ":" + uid);
      }
      room.locked = {};
      room.lockTransactionId = null;
      await onChange?.();
      return { ok: false, player: item, coins: result.coins, required: reserve };
    }
    reserved.push(item.uid);
    room.locked[item.uid] = reserve;
    if (onChange && await onChange() === false) {
      for (const uid of reserved) {
        await changeWallet(Users, uid, reserve, "refund:" + room.id + ":" + room.lockTransactionId + ":" + uid);
      }
      room.locked = {};
      room.lockTransactionId = null;
      await onChange();
      return { ok: false, player: item, coins: wallet.coins, required: reserve, storageError: true };
    }
  }
  return { ok: true, reserve };
}

async function refundRoomWallets(Users, room) {
  for (const item of room.players || []) {
    const amount = Number(room.locked?.[item.uid]) || 0;
    if (amount > 0) {
      await changeWallet(Users, item.uid, amount, "refund:" + room.id + ":" + (room.lockTransactionId || "retry") + ":" + item.uid);
    }
  }
  room.locked = {};
  room.lockTransactionId = null;
}

async function settleRoomWallets(Users, room, results) {
  if (room.settled) return [];
  const count = results.length;
  const lines = [];
  for (const result of results) {
    const locked = Number(room.locked?.[result.uid]) || 0;
    const net = (count + 1 - 2 * result.place) * room.bet;
    const credit = Math.max(0, locked + net);
    const outcome = await changeWallet(
      Users,
      result.uid,
      credit,
      "settle:" + room.id + ":" + result.uid,
      {
        mutateData(data, wallet) {
          wallet.games += 1;
          if (result.place === 1) wallet.wins += 1;
          else wallet.losses += 1;
          if (result.name) wallet.name = String(result.name).slice(0, 40);
          data.tlmn = wallet;
        }
      }
    );
    if (!outcome.ok) {
      room.settlementError = "Không thể chốt xu cho " + result.uid;
      throw new Error(room.settlementError);
    }
    const labels = ["Nhất", "Nhì", "Ba", "Bét"];
    lines.push({
      ...result,
      label: labels[result.place - 1] || ("Hạng " + result.place),
      change: net,
      coins: outcome.coins
    });
  }
  room.settled = true;
  room.settlementError = null;
  return lines;
}

function formatMoney(value) {
  const amount = Math.max(0, Math.floor(Number(value) || 0));
  if (amount >= 1000000 && amount % 1000000 === 0) return (amount / 1000000) + "M$";
  if (amount >= 1000 && amount % 1000 === 0) return (amount / 1000) + "K$";
  return amount.toLocaleString("vi-VN") + "$";
}

function parseAmount(value) {
  const source = String(value || "").toLowerCase().replace(/[$,\s]/g, "").trim();
  const match = source.match(/^(\d+(?:\.\d+)?)(k|m|tr)?$/);
  if (!match) return null;
  const multiplier = match[2] === "k" ? 1000 : (match[2] === "m" || match[2] === "tr") ? 1000000 : 1;
  const amount = Math.floor(Number(match[1]) * multiplier);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function tierForCoins(coins) {
  if (coins >= 10000000) return { vip: "👑 VIP Hoàng Gia", title: "Đại Gia Hoàng Gia" };
  if (coins >= 3000000) return { vip: "💎 VIP Kim Cương", title: "Tỷ Phú Sòng Bài" };
  if (coins >= 1000000) return { vip: "🥇 VIP Vàng", title: "Đại Gia" };
  if (coins >= 300000) return { vip: "🥈 VIP Bạc", title: "Phú Hào" };
  if (coins >= 100000) return { vip: "🥉 VIP Đồng", title: "Tân Binh Giàu Có" };
  return { vip: "🎟️ Thành viên", title: "Tân Binh Sòng Bài" };
}

function isAdmin(uid) {
  const lists = [
    global.users?.admin, global.users?.spadmin,
    global.config?.admin?.users, global.config?.admin?.spadmin
  ];
  return lists.some(list => Array.isArray(list) && list.some(value => String(value) === String(uid)));
}

function isEnabled(Threads, threadId) {
  if (!Threads || !threadId) return true;
  const record = Threads.getCachedData?.(threadId);
  const data = record?.data && typeof record.data === "object" ? record.data : record;
  return data?.tlmn_enabled !== false;
}

async function setEnabled(Threads, threadId, enabled) {
  const record = await Threads.getData(threadId);
  const data = { ...(record?.data || {}), tlmn_enabled: Boolean(enabled) };
  if (typeof Threads.setDataAndWait === "function") await Threads.setDataAndWait(threadId, data);
  else await Threads.setData(threadId, data);
}

function help(prefix) {
  return [
    "🃏 TIẾN LÊN MIỀN NAM — SÒNG BÀI HOÀNG GIA",
    "",
    "🕹️ BÀN CHƠI",
    prefix + "tlmn go — Mở bàn mới hoặc vào bàn đang chờ",
    prefix + "tlmn leave — Rời bàn",
    prefix + "tlmn cuoc <tiền> — Đổi cược, ví dụ cuoc 10k",
    prefix + "tlmn mode <nhatnhi|demla> — Chọn cách xếp hạng",
    "",
    "👥 LỆNH TRONG BÀN (không cần prefix)",
    "join <mã 5 số> — Vào bàn trong nhóm",
    "start — Chủ phòng bắt đầu (2–4 người)",
    "stop — Chủ phòng hủy bàn",
    "bo / pass — Bỏ lượt khi có người đánh trước",
    "Gửi lá bài: 3b, 10r, 2c hoặc nhiều lá liền nhau",
    "doi 4 — Chọn đôi 4  •  sanh 4567 — Chọn sảnh",
    "tuquy 4 — Chọn tứ quý  •  doithong  — đánh các lá đôi thông",
    "",
    "♠️ KÝ HIỆU CHẤT",
    SUIT_HELP,
    "",
    "💰 TÀI CHÍNH",
    prefix + "tlmn info — Ví, VIP và danh hiệu",
    prefix + "tlmn bxh [all] — Top đại gia",
    prefix + "tlmn pay @user <tiền> — Chuyển xu",
    "",
    "🖥️ QUẢN TRỊ",
    prefix + "tlmn on / off — Bật/tắt game trong nhóm",
    prefix + "tlmn nap @user <tiền> — Nạp xu (Spadmin)",
    "",
    "⚠️ Đây là xu ảo chỉ dùng trong game, không phải tiền thật.",
    "👉 Gõ " + prefix + "tlmn go để mở bàn."
  ].join("\n");
}

function modeLabel(mode) {
  return mode === "demla" ? "Đếm Lá" : "Nhất Nhì Ba Bét";
}

function tableCaption(room, notice = "") {
  const players = (room.players || []).map((item, index) => {
    const active = item.uid === room.turnUid;
    const handCount = item.handCount == null ? "đang chờ" : (item.handCount + " lá");
    return (active ? "▶ " : "• ") + (index + 1) + ". " + item.name + " — " + handCount;
  });
  const current = room.lastPlay
    ? "🃏 Vừa đánh: " + room.lastPlay.name + " — " +
      engine.formatCards(room.lastPlay.cards)
    : "🃏 Chưa có lượt đánh.";
  const turn = room.status === "waiting"
    ? "⏳ Đang chờ người chơi tham gia (" + room.playerCount + "/4 người)..."
    : room.turnUid
      ? "🎯 Đến lượt: " + (room.players.find(item => item.uid === room.turnUid)?.name || "Người chơi")
      : "🏁 Ván đã kết thúc.";
  return [
    "🃏 BÀN CHƠI TIẾN LÊN MIỀN NAM #" + room.id,
    "",
    "👑 Chủ phòng: " + room.ownerName,
    "💰 Mức cược: " + formatMoney(room.bet) + " • 📜 Chế độ: " + modeLabel(room.mode),
    turn,
    ...(room.status === "waiting" ? ["⏱️ Bàn tự hủy sau 60 giây nếu chưa đủ người."] : []),
    "",
    ...players,
    "",
    current,
    notice,
    room.status === "waiting"
      ? "👉 Nhắn join " + room.id + " để vào bàn ngay!"
      : "💡 Bài được gửi riêng. Gửi lá bài trong nhóm để đánh; bo/pass để bỏ lượt."
  ].filter(Boolean).join("\n");
}

async function renderImage(api, kind, key, threadId, type, data, caption, fallbackText) {
  let imagePath = null;
  try {
    imagePath = await renderCanvas("tlmn", data, { timeout: 20000, poolSize: 1 });
    const payload = { msg: caption, attachments: [imagePath], recallAfterMs: 0, ttlKind: "card" };
    if (kind === "group") {
      return await sendReplacement(api, key, threadId, type,
        rawApi => rawApi.sendMessage(withRequesterMention(data.event, payload), threadId, type));
    }
    return await sendReplacement(api, key, threadId, type,
      rawApi => rawApi.sendMessage(payload, threadId, type));
  } catch (error) {
    console.error("[TLMN_CANVAS]", error?.stack || error);
    const rawApi = getRawApi(api);
    try {
      if (kind === "group") return await rawApi.sendMessage(withRequesterMention(data.event, { msg: fallbackText || caption }), threadId, type);
      return await rawApi.sendMessage({ msg: fallbackText || caption }, threadId, type);
    } catch (sendError) {
      console.error("[TLMN_SEND]", sendError?.message || sendError);
      return null;
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

async function sendGroupRoom(api, event, room, notice = "") {
  const caption = tableCaption(room, notice);
  return renderImage(
    api, "group", "group:" + room.threadId, room.threadId, event.type,
    { view: "table", room, event },
    caption,
    caption
  );
}

async function sendPrivateHand(api, room, item, hand, turn = false) {
  const key = "hand:" + room.id + ":" + item.uid;
  const handLabels = engine.formatCards(hand);
  const suitNames = { b: "Bích", ch: "Chuồn", r: "Rô", c: "Cơ" };
  const codeCards = hand.map(card => card.id).join("  ");
  const namedCards = hand.map(card =>
    engine.rankLabel(card.rank) + suitNames[card.suit]
  ).join(", ");
  const caption = [
    "🃏 BÀI TRÊN TAY CỦA BẠN (" + hand.length + " lá):",
    "👑 " + String(item.name || "Người chơi").toUpperCase(),
    "",
    "👉 " + codeCards,
    "(" + namedCards + ")",
    "",
    turn ? "🎯 ĐẾN LƯỢT BẠN — hãy đánh bài hoặc bỏ lượt." : "🔒 Chỉ bạn nhìn thấy các lá bài này.",
    "",
    "⚡ LỆNH ĐÁNH NHANH GỢI Ý:",
    "• Đánh lẻ: 4r, 10b, jc, 2c",
    "• Đôi: Đôi 3 (doi 3), Đôi 4 (doi 4), Đôi K (doi k)",
    "• Sám cô: sam 7",
    "• Đôi thông: 3 đôi thông (3dt), 4 đôi thông (4dt)",
    "• Sảnh: sanh 345, sanh 10-j-q, sanh jqk",
    "• Tứ quý: tuquy 4",
    "• Bỏ lượt: bo / pass",
    "",
    "♠ Bích (b) • ♣ Chuồn (ch) • ♦ Rô (r) • ♥ Cơ (c)",
    "💡 Có thể gõ có dấu hoặc không dấu."
  ].join("\n");
  const rawApi = getRawApi(api);
  let imagePath = null;
  let delivered = false;
  try {
    imagePath = await renderCanvas("tlmn", {
      view: "hand",
      room: { id: room.id, bet: room.bet, mode: room.mode },
      player: item,
      hand: hand.map(card => ({ ...card })),
      isTurn: turn
    }, { timeout: 20000, poolSize: 1 });
    await sendReplacement(api, key, item.uid, ThreadType.User, rawApiInstance =>
      rawApiInstance.sendMessage({ msg: caption, attachments: [imagePath], recallAfterMs: 0, ttlKind: "card" },
        item.uid, ThreadType.User));
    delivered = true;
  } catch (error) {
    console.error("[TLMN_PRIVATE_HAND]", error?.stack || error);
    try {
      await rawApi.sendMessage({ msg: fallback }, item.uid, ThreadType.User);
      delivered = true;
    } catch {}
  } finally {
    if (imagePath) {
      const timer = setTimeout(() => {
        try { fs.rmSync(imagePath, { force: true }); } catch {}
      }, 60000);
      timer.unref?.();
    }
  }
  return delivered;
}

async function notifyPrivate(api, uid, message) {
  const rawApi = getRawApi(api);
  try {
    await rawApi.sendMessage({ msg: message, recallAfterMs: 0 }, String(uid), ThreadType.User);
  } catch (error) {
    console.warn("[TLMN_DM]", error?.message || error);
  }
}

async function distributeHands(api, room) {
  const failed = [];
  for (const item of room.players) {
    const hand = room.hands[item.uid] || [];
    const sent = await sendPrivateHand(api, room, item, hand, item.uid === room.turnUid);
    if (!sent) failed.push(item.name);
  }
  return failed;
}

async function endGame(api, event, Users, roomState, Threads) {
  const room = roomState;
  if (Threads && await persistRoom(Threads, room.threadId) === false) {
    await sendText(api, event, "⚠️ Chưa thể lưu kết quả ván bài vào database; xu chưa được chốt để tránh sai lệch số dư.");
    return;
  }
  let payoutLines = [];
  try {
    payoutLines = await settleRoomWallets(Users, room, room.results || []);
  } catch (error) {
    console.error("[TLMN_SETTLEMENT]", error?.stack || error);
    await persistRoom(Threads, room.threadId);
    await sendText(api, event, "⚠️ Ván đã kết thúc nhưng chốt xu chưa thành công. Dữ liệu bàn được giữ lại để tự thử chốt lại sau khi bot khôi phục: " + error.message);
    return;
  }

  await recallRoomCards(api, room);
  const lines = [
    "🏁 KẾT THÚC VÁN #" + room.id + " 🏁",
    ""
  ];
  for (const result of payoutLines) {
    const sign = result.change > 0 ? "+" : "";
    lines.push(
      (result.place === 1 ? "👑 " : "• ") + "**" + result.name + "** (" + result.label +
      "): **" + sign + formatMoney(result.change) + "**"
    );
  }
  lines.push("", "👉 Ván bài đã kết thúc! Nhắn **!tlmn go** (hoặc **go**) để mở bàn mới và chơi tiếp nhé!");
  game.removeRoom(room.threadId);
  if (Threads) await persistRoom(Threads, room.threadId);
  return sendText(api, event, lines.join("\n"));
}

async function cancelRoom(api, event, Users, room, message) {
  if (room.status === "playing" && room.locked) await refundRoomWallets(Users, room);
  await recallRoomCards(api, room);
  game.removeRoom(room.threadId);
  return sendText(api, event, message);
}

function gameConflict(threadId) {
  try {
    const caro = require("../../core/runtime/services/games/caroService");
    if (caro.isBusy?.(threadId)) return "Caro";
  } catch {}
  try {
    const noitu = require("../../core/runtime/services/games/noituService");
    const quick = require("../../core/runtime/services/games/noituQuickService");
    const room = require("../../core/runtime/services/games/noituRoomService");
    const ghepchu = require("../../core/runtime/services/games/ghepchuService");
    if (noitu.get?.(threadId)?.status === "active" ||
        quick.get?.(threadId)?.status === "active" ||
        room.get?.(threadId) || ghepchu.get?.(threadId)?.status === "active") return "Nối Từ/Ghép Chữ";
  } catch {}
  return null;
}

async function createOrJoin({ api, event, Users, Threads }) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const name = event?.data?.dName || event?.data?.name || "Người chơi";
  if (event?.type !== ThreadType.Group) return sendText(api, event, "⚠️ Game Tiến Lên chỉ mở trong nhóm.");
  if (!isEnabled(Threads, threadId)) return sendText(api, event, "🚫 Game Tiến Lên đã tắt trong nhóm này.");
  const existing = game.get(threadId);

  if (existing?.status === "waiting") {
    const joined = game.joinWaiting(threadId, { uid, name });
    if (!joined.ok) return sendText(api, event, "⚠️ Không thể vào bàn đang chờ.");
    await sendGroupRoom(api, event, joined.room, joined.alreadyJoined ? "✅ Bạn đã có tên trong bàn." : "✅ " + name + " đã tham gia bàn.");
    await persistRoom(Threads, threadId);
    return;
  }
  if (existing?.status === "playing") {
    if (existing.players.some(item => item.uid === uid)) {
      const snap = game.snapshot(existing);
      await sendGroupRoom(api, event, snap, "✅ Bạn đang ở trong ván này.");
    } else {
      await sendText(api, event, "⚠️ Nhóm đang có một ván Tiến Lên. Hãy chờ ván hiện tại kết thúc.");
    }
    return;
  }

  const conflict = gameConflict(threadId);
  if (conflict) return sendText(api, event, "⚠️ Nhóm đang chơi game " + conflict + ". Hãy kết thúc game đó trước khi mở Tiến Lên.");

  const result = game.create(threadId, { uid, name }, { bet: 5000 });
  if (!result.ok) return sendText(api, event, "⚠️ Nhóm đã có bàn Tiến Lên đang hoạt động.");
  const room = result.state;
  game.watchLobby(threadId, async () => {
    await recallRoomCards(api, room);
    game.removeRoom(threadId);
    await persistRoom(Threads, threadId);
    await sendText(api, event, "⌛ Bàn Tiến Lên #" + room.id + " tự hủy sau 60 giây vì không đủ người chơi.");
  });
  await sendGroupRoom(api, event, result.room, "💡 Chủ phòng có thể đổi cược/chế độ trước khi bấm start.");
  await persistRoom(Threads, threadId);
}

async function joinRoom({ api, event, Users, Threads }, code) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  if (event?.type !== ThreadType.Group) return sendText(api, event, "⚠️ Hãy tham gia bàn trong nhóm đã mở bàn.");
  if (!isEnabled(Threads, threadId)) return sendText(api, event, "🚫 Game Tiến Lên đã tắt trong nhóm này.");
  const conflict = gameConflict(threadId);
  if (conflict) return sendText(api, event, "⚠️ Nhóm đang chơi game " + conflict + ".");
  const result = game.join(threadId, code, {
    uid,
    name: event?.data?.dName || event?.data?.name || "Người chơi"
  });
  if (!result.ok) {
    const messages = {
      ROOM_NOT_FOUND: "⚠️ Không tìm thấy mã bàn " + code + ".",
      WRONG_GROUP: "⚠️ Mã bàn này thuộc nhóm khác.",
      NOT_WAITING: "⚠️ Bàn đã bắt đầu hoặc đã đóng.",
      FULL: "⚠️ Bàn đã đủ 4 người."
    };
    return sendText(api, event, messages[result.code] || "⚠️ Không thể tham gia bàn.");
  }
  await sendGroupRoom(api, event, result.room, result.alreadyJoined
    ? "✅ Bạn đã có trong danh sách người chơi."
    : "✅ " + result.player.name + " đã vào bàn (" + result.room.playerCount + "/4).");
  await persistRoom(Threads, threadId);
}

async function startRoom({ api, event, Users, Threads }) {
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const state = game.get(threadId);
  if (!state || state.status !== "waiting") return sendText(api, event, "⚠️ Không có bàn đang chờ trong nhóm.");
  if (state.ownerId !== uid) return sendText(api, event, "⛔ Chỉ chủ phòng mới được bắt đầu.");
  if (state.players.length < 2) return sendText(api, event, "⚠️ Cần ít nhất 2 người chơi mới bắt đầu được.");
  await sendText(api, event, [
    "🔔 LƯU Ý QUAN TRỌNG TRƯỚC KHI BẮT ĐẦU VÁN BÀI:",
    "Tất cả người chơi vui lòng KHÔNG CHẶN TIN NHẮN NGƯỜI LẠ với Bot, để Bot có thể chia bài và gửi ảnh các lá bài trên tay vào tin nhắn riêng cho bạn nhé!",
    "📩 Nếu chưa nhận được bài, hãy mở chat riêng với Bot và nhắn tin cho Bot trước."
  ].join("\n"));
  const reserved = await reserveRoomWallets(Users, state, () => persistRoom(Threads, threadId));
  if (!reserved.ok) {
    return sendText(api, event, reserved.storageError
      ? "⚠️ Database không xác nhận được khoản giữ cược; xu đã được hoàn lại và bàn chưa bắt đầu."
      : "💸 " + reserved.player.name + " chưa đủ xu. Cần giữ trước " + formatMoney(reserved.required) + " (hiện có " + formatMoney(reserved.coins) + ").");
  }
  const result = game.start(threadId, uid);
  if (!result.ok) {
    await refundRoomWallets(Users, state);
    await persistRoom(Threads, threadId);
    return sendText(api, event, "⚠️ Không thể bắt đầu bàn. Vui lòng thử lại.");
  }

  const room = result.state;
  await persistRoom(Threads, threadId);
  const failedPrivate = await distributeHands(api, room);
  await sendGroupRoom(api, event, result.room, "🎮 Đã chia 13 lá riêng cho từng người. Người có 3♠ đi trước." +
    (failedPrivate.length ? "\n⚠️ Chưa gửi được bài riêng cho: " + failedPrivate.join(", ") + ". Người chơi hãy mở chat riêng với bot rồi yêu cầu chủ phòng chia lại." : ""));
  const first = room.players.find(item => item.uid === room.turnUid);
  if (first) await notifyPrivate(api, first.uid, "🎯 Đến lượt bạn. Bạn đang cầm 3♠ nên hãy đánh lá này hoặc tổ hợp có chứa 3♠.");
  await persistRoom(Threads, threadId);
}

async function doPlay(context, input) {
  const { api, event, Users, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const state = game.get(threadId);
  if (!state || state.status !== "playing") return false;

  const result = game.play(threadId, uid, input);
  if (!result.ok) {
    const errors = {
      NOT_PLAYER: "⚠️ Bạn không tham gia bàn này.",
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      UNRECOGNIZED_PLAY: "⚠️ Không hiểu cách đánh. Ví dụ: 4b, doi 4, sanh 4567, tuquy 4.",
      EMPTY_PLAY: "⚠️ Hãy nhập lá bài muốn đánh.",
      NOT_ENOUGH_CARDS: "⚠️ Bạn không có đủ lá để tạo tổ hợp đó.",
      INVALID_STRAIGHT: "⚠️ Sảnh phải gồm ít nhất 3 lá liên tiếp và không được có heo.",
      INVALID_COMBINATION: "⚠️ Bộ bài không hợp lệ. Hãy kiểm tra lẻ/đôi/sám/sảnh/tứ quý/đôi thông.",
      CARD_NOT_IN_HAND: "⚠️ Lá bài đó không có trong bài riêng của bạn.",
      DUPLICATE_CARD: "⚠️ Bạn đã nhập trùng một lá bài.",
      MUST_PLAY_THREE_SPADES: "⚠️ Vòng đầu phải có lá 3♠ (3b).",
      CANNOT_BEAT: "⛔ Bài này không chặt được bộ đang nằm trên bàn.",
      NO_GAME: "⚠️ Ván đã kết thúc."
    };
    if (errors[result.code]) await sendText(api, event, errors[result.code]);
    return true;
  }

  const room = result.state;
  const publicRoom = game.snapshot(room);
  const playerItem = room.players.find(item => item.uid === uid);
  if (result.finished) {
    return endGame(api, event, Users, room, context.Threads);
  }

  await sendGroupRoom(api, event, publicRoom,
    "✅ " + (playerItem?.name || "Người chơi") + " vừa đánh " +
    engine.formatCards(result.combo.cards) + " • Còn " + result.handCount + " lá.");
  if (playerItem) {
    await sendPrivateHand(api, room, playerItem, room.hands[uid] || [], room.turnUid === uid);
  }
  const next = room.players.find(item => item.uid === room.turnUid);
  if (next) {
    await sendPrivateHand(api, room, next, room.hands[next.uid] || [], true);
    await notifyPrivate(api, next.uid, "🎯 Đến lượt bạn. Hãy đánh bộ cao hơn hoặc nhắn bo/pass để bỏ lượt.");
  }
  await persistRoom(Threads, threadId);
  return true;
}

async function doPass(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const result = game.pass(threadId, uid);
  if (!result.ok) {
    const messages = {
      NOT_PLAYER: "⚠️ Bạn không tham gia bàn này.",
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      CANNOT_PASS_ON_LEAD: "⚠️ Bạn đang được quyền ra bài, không thể bỏ lượt ở vòng mới.",
      LEADER_CANNOT_PASS: "⚠️ Người vừa đánh bài không thể tự bỏ lượt ở vòng đó."
    };
    if (messages[result.code]) await sendText(api, event, messages[result.code]);
    return true;
  }
  const next = result.state.players.find(item => item.uid === result.state.turnUid);
  await sendGroupRoom(api, event, result.room,
    "↪️ " + (event?.data?.dName || event?.data?.name || "Người chơi") + " đã bỏ lượt" +
    (result.roundCleared ? " • Vòng mới bắt đầu." : "."));
  if (next) {
    await sendPrivateHand(api, result.state, next, result.state.hands[next.uid] || [], true);
    await notifyPrivate(api, next.uid, result.roundCleared
      ? "🔄 Mọi người đã bỏ lượt. Bạn được quyền đánh bộ mới."
      : "🎯 Đến lượt bạn. Hãy đánh bài hoặc bo/pass.");
  }
  await persistRoom(Threads, threadId);
  return true;
}

async function doLeave(context) {
  const { api, event, Users } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const state = game.get(threadId);
  if (!state) return sendText(api, event, "⚠️ Bạn chưa ở trong bàn Tiến Lên.");
  const result = game.leave(threadId, uid);
  if (!result.ok) return sendText(api, event, "⚠️ Bạn không ở trong bàn này.");
  if (result.finished) return endGame(api, event, Users, result.state, context.Threads);
  if (result.room) {
    await sendGroupRoom(api, event, result.room, "👋 Một người chơi đã rời bàn.");
    const next = result.state.players.find(item => item.uid === result.state.turnUid);
    if (next && result.state.status === "playing") {
      await sendPrivateHand(api, result.state, next, result.state.hands[next.uid] || [], true);
    }
  }
  if (result.empty) {
    await recallRoomCards(api, state);
    game.removeRoom(threadId);
  }
  await persistRoom(context.Threads, threadId);
  return sendText(api, event, result.forfeited
    ? "🚪 Bạn đã rời ván và bị xếp cuối bàn."
    : "👋 Bạn đã rời bàn chờ.");
}

async function runCommand(context) {
  const { args = [], api, event, Users, Threads } = context;
  const uid = String(event?.data?.uidFrom || "");
  const threadId = String(event?.threadId || "");
  const prefix = global.config?.prefix || "!";
  const action = String(args[0] || "help").toLowerCase();
  const rest = args.slice(1).map(value => String(value));
  if (action === "help") return sendText(api, event, help(prefix));

  if (action === "go") return createOrJoin(context);
  if (action === "join") return joinRoom(context, rest[0]);
  if (action === "start") return startRoom(context);
  if (action === "leave") return doLeave(context);
  if (action === "stop") {
    const previousRoom = game.get(threadId);
    const wasPlaying = previousRoom?.status === "playing";
    const result = game.stop(threadId, uid);
    if (!result.ok) return sendText(api, event, result.code === "NOT_OWNER"
      ? "⛔ Chỉ chủ phòng mới được hủy bàn."
      : "⚠️ Không có bàn Tiến Lên.");
    if (wasPlaying) await refundRoomWallets(Users, result.state);
    await recallRoomCards(api, result.state);
    await persistRoom(Threads, threadId);
    return sendText(api, event, "🛑 Đã hủy bàn #" + result.state.id + ". Xu đã được hoàn lại nếu ván đã bắt đầu.");
  }
  if (action === "cuoc" || action === "bet") {
    const amount = parseAmount(rest[0]);
    if (!amount) return sendText(api, event, "⚠️ Mức cược không hợp lệ. Ví dụ: !tlmn cuoc 10k.");
    const result = game.updateBet(threadId, uid, amount);
    if (!result.ok) return sendText(api, event, result.code === "NOT_OWNER"
      ? "⛔ Chỉ chủ phòng được đổi cược."
      : result.code === "ALREADY_STARTED" ? "⚠️ Ván đã bắt đầu, không thể đổi cược."
      : "⚠️ Cược phải từ 1K$ đến 10M$.");
    await sendGroupRoom(api, event, result.room, "💰 Chủ phòng đã đổi mức cược thành " + formatMoney(amount) + ".");
    await persistRoom(Threads, threadId);
    return;
  }
  if (action === "mode") {
    const mode = String(rest[0] || "").toLowerCase();
    const result = game.updateMode(threadId, uid, mode);
    if (!result.ok) return sendText(api, event, result.code === "NOT_OWNER"
      ? "⛔ Chỉ chủ phòng được đổi chế độ."
      : "⚠️ Chế độ hợp lệ: nhatnhi hoặc demla.");
    await sendGroupRoom(api, event, result.room, "📜 Chế độ đã chuyển sang " + modeLabel(mode) + ".");
    await persistRoom(Threads, threadId);
    return;
  }
  if (action === "on" || action === "off") {
    if (!isAdmin(uid)) return sendText(api, event, "⛔ Chỉ Spadmin/Admin bot mới được bật hoặc tắt game.");
    await setEnabled(Threads, threadId, action === "on");
    if (action === "off") {
      const room = game.get(threadId);
      if (room) {
        if (room.status === "playing") await refundRoomWallets(Users, room);
        await recallRoomCards(api, room);
        game.removeRoom(threadId);
        await persistRoom(Threads, threadId);
      }
    }
    return sendText(api, event, action === "on" ? "🟢 Đã bật Tiến Lên trong nhóm." : "🔴 Đã tắt Tiến Lên trong nhóm.");
  }
  if (action === "info") {
    const wallet = await readWallet(Users, uid);
    const tier = tierForCoins(wallet.coins);
    return sendText(api, event, [
      "💰 TÀI SẢN SÒNG BÀI",
      "🪙 Số dư: " + formatMoney(wallet.coins),
      tier.vip,
      "🏆 Danh hiệu: " + tier.title,
      "🎮 Số ván: " + wallet.games + " • Thắng: " + wallet.wins + " • Thua: " + wallet.losses
    ].join("\n"));
  }
  if (action === "bxh" || action === "rank") {
    const rows = (Users.getAll?.() || []).map(row => {
      const wallet = normalizeWallet(row?.data || {});
      return { uid: String(row.userId || ""), name: String(row?.data?.tlmn?.name || row?.data?.name || row.userId || "Người chơi"), coins: wallet.coins };
    }).filter(row => row.uid).sort((a, b) => b.coins - a.coins).slice(0, 10);
    if (!rows.length) return sendText(api, event, "🏆 Chưa có dữ liệu xếp hạng Tiến Lên.");
    return sendText(api, event, [
      "🏆 BXH ĐẠI GIA TIẾN LÊN",
      "",
      ...rows.map((row, index) => (index + 1) + ". " + row.name + " — " + formatMoney(row.coins)),
      "",
      "🪙 Tổng tài sản xu ảo trong sòng bài."
    ].join("\n"));
  }
  if (action === "pay" || action === "nap") {
    const transferId = crypto.randomUUID();
    const target = firstMention(event?.data || {});
    const amount = parseAmount(rest[rest.length - 1]);
    if (!target || !amount) return sendText(api, event, "⚠️ Dùng: !tlmn " + action + " @user 10k.");
    if (target === uid) return sendText(api, event, "⚠️ Không thể chuyển xu cho chính mình.");
    if (action === "nap" && !isAdmin(uid)) return sendText(api, event, "⛔ Chỉ Spadmin/Admin bot mới được nạp xu.");
    if (action === "pay") {
      const sender = await changeWallet(Users, uid, -amount, "pay-out:" + transferId);
      if (!sender.ok) return sendText(api, event, "💸 Bạn không đủ xu để chuyển " + formatMoney(amount) + ".");
    }
    const receiver = await changeWallet(Users, target, amount,
      (action === "nap" ? "admin-nap:" : "pay-in:") + (action === "nap" ? crypto.randomUUID() : transferId));
    if (!receiver.ok) {
      if (action === "pay") await changeWallet(Users, uid, amount, "pay-rollback:" + transferId);
      return sendText(api, event, "❌ Không thể cập nhật ví người nhận.");
    }
    return sendText(api, event, (action === "nap" ? "✅ Đã nạp " : "✅ Đã chuyển ") +
      formatMoney(amount) + " cho người chơi.");
  }
  return sendText(api, event, help(prefix));
}

async function handleIncoming(context = {}) {
  const { event, isSelf, Threads } = context;
  if (isSelf || event?.isSelf) return false;
  const content = String(event?.data?.content || "").trim();
  const prefix = String(global.config?.prefix || "!");
  if (!content || content.startsWith(prefix) || event?.type !== ThreadType.Group) return false;
  const lower = engine.normalizeText(content);
  const threadId = String(event?.threadId || "");
  const room = game.get(threadId);
  if (!isEnabled(Threads, threadId)) return false;

  if (lower === "go" && !room) {
    await createOrJoin(context);
    return true;
  }
  if (!room) return false;
  const joinMatch = lower.match(/^join\s+(\d{5})$/);
  if (joinMatch && room.status === "waiting") {
    await joinRoom(context, joinMatch[1]);
    return true;
  }
  if (lower === "start" && room.status === "waiting") {
    await startRoom(context);
    return true;
  }
  if (lower === "stop") {
    await runCommand({ ...context, args: ["stop"] });
    return true;
  }
  if (lower === "leave") {
    await doLeave(context);
    return true;
  }
  if (["bo", "pass", "skip"].includes(lower) && room.status === "playing") {
    await doPass(context);
    return true;
  }
  if (room.status === "playing" && room.activeUids.includes(String(event?.data?.uidFrom || ""))) {
    const hasCardSyntax = /(10|[3-9]|[jqka2])(ch|dt|b|r|c|t)/i.test(lower) ||
      /^(doi(\s*thong)?|doithong|pair|double|tu\s*quy|tuquy|four|sanh|straight|le|single)\b/.test(lower);
    if (hasCardSyntax) {
      await doPlay(context, content);
      return true;
    }
  }
  return false;
}

module.exports.run = runCommand;
module.exports.handleIncoming = handleIncoming;

module.exports.onLoad = async function ({ api, Users, Threads } = {}) {
  if (!Threads?.getAll) return;
  const records = Threads.getAll() || [];
  for (const record of records) {
    const threadId = String(record?.threadId || record?.id || "");
    const saved = record?.data?.tlmn_room;
    if (!threadId || !saved) continue;

    const room = game.restore(saved);
    if (!room) {
      const current = await Threads.getData(threadId).catch(() => null);
      const data = { ...(current?.data || {}) };
      delete data.tlmn_room;
      if (typeof Threads.setDataAndWait === "function") await Threads.setDataAndWait(threadId, data);
      else await Threads.setData(threadId, data);
      continue;
    }
    restoreRoomCards(room);

    // If the process stopped in the middle of reserving buy-ins, refund every
    // confirmed reservation before reopening the waiting room.
    if (room.status === "waiting" && Object.keys(room.locked || {}).length) {
      await refundRoomWallets(Users, room);
      await persistRoom(Threads, threadId);
    }

    if (room.status === "waiting") {
      game.watchLobby(threadId, async () => {
        await recallRoomCards(api, room);
        game.removeRoom(threadId);
        await persistRoom(Threads, threadId);
        const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
        await sendText(api, syntheticEvent, "⌛ Bàn Tiến Lên #" + room.id + " tự hủy sau 60 giây vì không đủ người chơi.");
      });
    } else if (room.status === "finished" && !room.settled) {
      const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
      await endGame(api, syntheticEvent, Users, room, Threads);
    }
  }
};

module.exports._test = {
  parseAmount, formatMoney, normalizeWallet, tierForCoins,
  tableCaption, recallTargets, reserveRoomWallets, settleRoomWallets,
  getRawApi
};
