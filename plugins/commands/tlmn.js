"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { ThreadType } = require("zalo-client");
const { renderCanvas } = require("../../core/canvas/workerRender");
const game = require("../../core/runtime/services/games/tlmnService");
const engine = require("../../core/games/tlmnEngine");
const { firstMention, withRequesterMention } = require("../../core/mentions");
const { getRequesterProfile } = require("../../core/runtime/requesterProfile");

const DEFAULT_COINS = 100000;
const MIN_BET = 1000;
const MAX_BET = 10000000;
const groupCards = new Map();
const privateCards = new Map();
const walletLocks = new Map();
const roomSaveLocks = new Map();
const roomActionLocks = new Map();
const messageLocks = new Map();
const cleanupTimers = new Map();
const AI_UID_PREFIX = "tlmn-ai:";
const aiTimers = new Map();
const moveErrorNotices = new Map();
const groupMoveErrorNotices = new Map();
const MOVE_ERROR_USER_COOLDOWN_MS = 12000;
const MOVE_ERROR_GROUP_COOLDOWN_MS = 2500;
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

function withRoomActionLock(threadId, operation) {
  const key = String(threadId || "");
  if (!key) return Promise.resolve().then(operation);
  const previous = roomActionLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  roomActionLocks.set(key, current);
  return current.finally(() => {
    if (roomActionLocks.get(key) === current) roomActionLocks.delete(key);
  });
}

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

function withMessageLock(key, operation) {
  const previous = messageLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  messageLocks.set(key, current);
  return current.finally(() => {
    if (messageLocks.get(key) === current) messageLocks.delete(key);
  });
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

function shouldSendMoveError(threadId, uid, code, now = Date.now()) {
  const groupKey = String(threadId || "");
  const userKey = groupKey + ":" + String(uid || "");
  const userUntil = moveErrorNotices.get(userKey) || 0;
  const groupUntil = groupMoveErrorNotices.get(groupKey) || 0;
  if (now < userUntil || now < groupUntil) return false;

  const userCooldown = code === "UNRECOGNIZED_PLAY" ? 18000 : MOVE_ERROR_USER_COOLDOWN_MS;
  moveErrorNotices.set(userKey, now + userCooldown);
  groupMoveErrorNotices.set(groupKey, now + MOVE_ERROR_GROUP_COOLDOWN_MS);

  if (moveErrorNotices.size > 1000) {
    for (const [key, expiry] of moveErrorNotices) {
      if (expiry <= now) moveErrorNotices.delete(key);
      if (moveErrorNotices.size <= 700) break;
    }
  }
  if (groupMoveErrorNotices.size > 500) {
    for (const [key, expiry] of groupMoveErrorNotices) {
      if (expiry <= now) groupMoveErrorNotices.delete(key);
      if (groupMoveErrorNotices.size <= 350) break;
    }
  }
  return true;
}

async function sendMoveError(api, event, uid, code, message) {
  if (!shouldSendMoveError(event?.threadId, uid, code)) return false;
  await sendText(api, event, message);
  return true;
}

async function sendPrivateNotice(api, uid, message) {
  const destination = privateDestination(api, uid);
  return getRawApi(api).sendMessage(
    { msg: String(message || "") },
    destination.threadId,
    destination.type
  );
}

function isAiUid(uid) {
  return String(uid || "").startsWith(AI_UID_PREFIX);
}

function privateDestination(api, uid) {
  const targetUid = String(uid || "");
  const ownUid = String(api?.getOwnId?.() || "");
  if (ownUid && targetUid === ownUid) {
    const context = api?.getContext?.();
    const myDocumentsId = String(context?.loginInfo?.send2me_id || "").trim();
    if (!myDocumentsId) {
      throw new Error("Không lấy được send2me_id của My Documents từ phiên Zalo.");
    }
    return {
      threadId: myDocumentsId,
      type: ThreadType.User,
      myDocuments: true
    };
  }
  if (!targetUid) throw new Error("Thiếu UID người nhận bài.");
  return {
    threadId: targetUid,
    type: ThreadType.User,
    myDocuments: false
  };
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
      const result = await rawApi.undo({ msgId: target.msgId, cliMsgId: target.cliMsgId }, String(threadId), type);
      if (result === false || result?.success === false) {
        throw new Error("Zalo từ chối thu hồi tin nhắn");
      }
    } catch (error) {
      failed.push(target);
      console.warn("[TLMN_RECALL]", error?.message || error);
    }
  }
  return failed;
}

async function sendReplacement(api, key, threadId, type, makePayload) {
  return withMessageLock(key, async () => {
    const rawApi = getRawApi(api);
    const previous = privateCards.get(key) || groupCards.get(key) || [];
    const response = await makePayload(rawApi);
    const next = recallTargets(response);
    if (!next.length) {
      console.warn("[TLMN_CANVAS] Zalo không trả message ID; giữ lại card cũ.");
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
        room.messageCards.private[key.split(":")[2]] = [...next, ...failed];
      } else {
        room.messageCards.group = [...next, ...failed];
      }
    }
    return response;
  });
}

function forgetCards(key) {
  if (key.startsWith("hand:")) privateCards.delete(key);
  else groupCards.delete(key);
}

async function recallRoomCards(api, room) {
  const rawApi = getRawApi(api);
  const groupKey = "group:" + room.threadId;
  const oldGroup = groupCards.get(groupKey) || room.messageCards?.group || [];
  const failedGroup = await recallMessages(rawApi, room.threadId, ThreadType.Group, oldGroup);
  if (failedGroup.length) {
    groupCards.set(groupKey, failedGroup);
    if (room.messageCards) room.messageCards.group = failedGroup;
  } else {
    forgetCards(groupKey);
    if (room.messageCards) room.messageCards.group = [];
  }

  const failures = failedGroup.length;
  for (const item of room.players || []) {
    const key = "hand:" + room.id + ":" + item.uid;
    const targets = privateCards.get(key) || room.messageCards?.private?.[item.uid] || [];
    let failed;
    try {
      const destination = privateDestination(api, item.uid);
      failed = await recallMessages(rawApi, destination.threadId, destination.type, targets);
    } catch (error) {
      console.warn("[TLMN_RECALL]", error?.message || error);
      failed = targets;
    }
    if (failed.length) {
      privateCards.set(key, failed);
      if (room.messageCards?.private) room.messageCards.private[item.uid] = failed;
    } else {
      forgetCards(key);
      if (room.messageCards?.private) delete room.messageCards.private[item.uid];
    }
    if (failed.length) failures += failed.length;
  }
  return failures;
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
  const hasCoins = Object.prototype.hasOwnProperty.call(source, "coins");
  const coins = Number(source.coins);
  if (hasCoins && (source.coins == null || String(source.coins).trim() === "" ||
      !Number.isSafeInteger(coins) || coins < 0)) {
    throw new Error("Ví Tiến Lên có số dư lỗi; đã khóa thao tác để tránh tự đặt lại số xu.");
  }
  return {
    ...source,
    coins: hasCoins ? coins : DEFAULT_COINS,
    games: Math.max(0, Number(source.games) || 0),
    wins: Math.max(0, Number(source.wins) || 0),
    losses: Math.max(0, Number(source.losses) || 0),
    transactions: Array.isArray(source.transactions) ? source.transactions.slice(-2000) : [],
    pendingTransfers: Array.isArray(source.pendingTransfers) ? source.pendingTransfers.slice(-50) : []
  };
}

async function saveUserData(Users, uid, data) {
  if (typeof Users?.setDataAndWait === "function") {
    return Users.setDataAndWait(String(uid), data);
  }
  if (typeof Users?.setData !== "function") {
    throw new Error("User service không hỗ trợ ghi dữ liệu người chơi");
  }
  return Users.setData(String(uid), data);
}

async function readWallet(Users, uid) {
  return withWalletLock(uid, async () => {
    const record = await Users.getData(String(uid));
    const data = record?.data && typeof record.data === "object" ? { ...record.data } : {};
    const hadWallet = data.tlmn && Number.isSafeInteger(Number(data.tlmn.coins)) && Number(data.tlmn.coins) >= 0;
    const wallet = normalizeWallet(data);
    if (!hadWallet) {
      data.tlmn = wallet;
      await saveUserData(Users, uid, data);
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
    wallet.transactions = wallet.transactions.slice(-2000);
    data.tlmn = wallet;
    if (typeof options.mutateData === "function") options.mutateData(data, wallet);
    await saveUserData(Users, uid, data);
    return { ok: true, coins: wallet.coins };
  });
}

async function reconcilePendingReservations(Users, room, onChange = null) {
  room.locked ||= {};
  room.lockPending ||= {};
  try {
    for (const [uid, pending] of Object.entries(room.lockPending)) {
      const wallet = await readWallet(Users, uid);
      const transactionId = String(pending?.transactionId || "");
      const debited = Boolean(transactionId && wallet.transactions.includes(transactionId));
      if (debited) room.locked[uid] = Math.max(0, Number(pending.amount) || 0);
      delete room.lockPending[uid];
      if (onChange && await onChange() !== true) {
        room.lockPending[uid] = pending;
        if (debited) delete room.locked[uid];
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("[TLMN_RESERVATION_RECOVERY]", error?.stack || error);
    return false;
  }
}

async function refundRoomWallets(Users, room, onChange = null) {
  try {
    if (!await reconcilePendingReservations(Users, room, onChange)) return false;
    const lockId = String(room.lockTransactionId || "legacy");
    for (const [uid, rawAmount] of Object.entries(room.locked || {})) {
      const amount = Math.max(0, Number(rawAmount) || 0);
      if (!amount) {
        delete room.locked[uid];
        continue;
      }
      const result = await changeWallet(
        Users, uid, amount, "refund:" + room.id + ":" + lockId + ":" + uid
      );
      if (!result.ok) return false;
      delete room.locked[uid];
      if (onChange && await onChange() !== true) {
        room.locked[uid] = amount; // same refund transaction is safe to retry
        return false;
      }
    }
    if (Object.keys(room.locked || {}).length || Object.keys(room.lockPending || {}).length) return false;
    const previousLockId = room.lockTransactionId;
    room.lockTransactionId = null;
    if (onChange && await onChange() !== true) {
      room.lockTransactionId = previousLockId;
      return false;
    }
    return true;
  } catch (error) {
    console.error("[TLMN_REFUND]", error?.stack || error);
    return false;
  }
}

async function reserveRoomWallets(Users, room, onChange = null) {
  if (!Array.isArray(room.players) || room.players.length < 2 || room.players.length > 4 ||
      !Number.isSafeInteger(room.bet) || room.bet < MIN_BET || room.bet > MAX_BET) {
    return { ok: false, storageError: true };
  }
  const reserve = room.bet * (room.players.length - 1);
  room.locked ||= {};
  room.lockPending ||= {};
  if (!await reconcilePendingReservations(Users, room, onChange)) {
    return { ok: false, storageError: true };
  }
  if (Object.keys(room.locked).length) {
    if (!await refundRoomWallets(Users, room, onChange)) {
      return { ok: false, storageError: true, refundPending: true };
    }
  }

  room.lockTransactionId ||= crypto.randomUUID();
  const lockId = room.lockTransactionId;
  for (const item of room.players) {
    let wallet;
    try {
      wallet = await readWallet(Users, item.uid);
    } catch (error) {
      console.error("[TLMN_RESERVE_READ]", error?.stack || error);
      const refunded = await refundRoomWallets(Users, room, onChange);
      return { ok: false, storageError: true, refundPending: !refunded };
    }
    if (wallet.coins < reserve) {
      const refunded = await refundRoomWallets(Users, room, onChange);
      return { ok: false, player: item, coins: wallet.coins, required: reserve, refundPending: !refunded };
    }

    const transactionId = "reserve:" + room.id + ":" + lockId + ":" + item.uid;
    room.lockPending[item.uid] = { amount: reserve, transactionId };
    if (onChange && await onChange() !== true) return { ok: false, storageError: true };

    let debit;
    try {
      debit = await changeWallet(Users, item.uid, -reserve, transactionId);
    } catch (error) {
      console.error("[TLMN_RESERVE]", error?.stack || error);
      return { ok: false, storageError: true };
    }
    if (!debit.ok) {
      delete room.lockPending[item.uid];
      if (onChange && await onChange() !== true) return { ok: false, storageError: true };
      const refunded = await refundRoomWallets(Users, room, onChange);
      return { ok: false, player: item, coins: debit.coins, required: reserve, refundPending: !refunded };
    }

    room.locked[item.uid] = reserve;
    delete room.lockPending[item.uid];
    if (onChange && await onChange() !== true) {
      delete room.locked[item.uid];
      room.lockPending[item.uid] = { amount: reserve, transactionId };
      return { ok: false, storageError: true };
    }
  }
  return { ok: true, reserve };
}

async function settleRoomWallets(Users, room, results) {
  if (room.settled) return [];
  if (!Array.isArray(results) || !Array.isArray(room.players) ||
      results.length !== room.players.length || results.length < 2 || results.length > 4) {
    throw new Error("Bảng xếp hạng không hợp lệ; không chốt xu.");
  }
  const rankedUids = results.map(row => String(row?.uid || ""));
  const playerUids = room.players.map(row => String(row?.uid || ""));
  if (new Set(rankedUids).size !== results.length ||
      new Set(playerUids).size !== playerUids.length ||
      rankedUids.some(uid => !playerUids.includes(uid)) ||
      results.some((row, index) => !Number.isInteger(Number(row.place)) ||
        Number(row.place) !== index + 1)) {
    throw new Error("Thứ hạng người chơi không hợp lệ; không chốt xu.");
  }
  const count = results.length;
  const requiredLock = room.bet * (count - 1);
  if (!Number.isSafeInteger(requiredLock) || requiredLock <= 0 ||
      results.some(row => Number(room.locked?.[row.uid]) !== requiredLock)) {
    throw new Error("Thiếu khoản giữ cược của một hoặc nhiều người; giữ nguyên bàn để đối soát, không phát xu.");
  }
  const lines = [];
  for (const result of results) {
    const locked = Number(room.locked?.[result.uid]) || 0;
    const net = (count + 1 - 2 * result.place) * room.bet;
    const credit = Math.max(0, locked + net);
    const outcome = await changeWallet(
      Users,
      result.uid,
      credit,
      "settle:" + String(room.gameToken || room.id) + ":" + result.uid,
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

async function reconcilePendingTransfers(Users) {
  const rows = Users?.getAll?.() || [];
  const recovered = [];
  for (const row of rows) {
    const senderId = String(row?.userId || "");
    const pending = Array.isArray(row?.data?.tlmn?.pendingTransfers)
      ? row.data.tlmn.pendingTransfers.slice() : [];
    if (!senderId) continue;
    for (const transfer of pending) {
      const transferId = String(transfer?.id || "");
      const targetId = String(transfer?.target || "");
      const amount = Number(transfer?.amount);
      if (!transferId || !targetId || senderId === targetId ||
          !Number.isSafeInteger(amount) || amount <= 0) continue;
      try {
        const credit = await changeWallet(Users, targetId, amount, "pay-in:" + transferId);
        if (!credit.ok) continue;
        const finalized = await changeWallet(
          Users, senderId, 0, "pay-settled:" + transferId,
          { mutateData(data, wallet) {
            wallet.pendingTransfers = wallet.pendingTransfers.filter(
              item => String(item?.id || "") !== transferId
            );
            data.tlmn = wallet;
          }}
        );
        if (finalized.ok) recovered.push(transferId);
      } catch (error) {
        console.error("[TLMN_TRANSFER_RECOVERY]", error?.stack || error);
      }
    }
  }
  return recovered;
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
    prefix + "tlmn ai — Chơi luyện tập với 3 AI (Admin)",
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
    "chon 1,2 — Chọn bài theo số thứ tự trên ảnh (từ trái sang phải)",
    "goiy — Gửi gợi ý riêng • auto — Tự đánh bộ hợp lệ nhanh nhất",
    "doi 4 — Chọn đôi 4  •  sanh 4567 — Chọn sảnh",
    "tuquy 4 — Chọn tứ quý  •  3dt / 4dt — chọn đôi thông",
    "Mở ván cần 3♠; không ghép 2 vào sảnh.",
    "Luật chặt: 3 đôi thông chặt heo; tứ quý chặt heo/đôi heo/3 đôi thông; 4 đôi thông chặt cả tứ quý và các bộ nhỏ hơn.",
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

function buildTurnMentionCaption(room, caption) {
  const activePlayer = (room?.players || []).find(item =>
    String(item.uid) === String(room?.turnUid)
  );
  if (room?.status !== "playing" || !activePlayer ||
      activePlayer.ai || isAiUid(activePlayer.uid)) {
    return { caption: String(caption || ""), mentions: [] };
  }
  const cleanName = String(activePlayer.name || "Người chơi")
    .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Người chơi";
  const tag = "@" + cleanName;
  const line = "\n\n🎯 " + tag + " — tới lượt bạn, hãy đánh bài!";
  const message = String(caption || "") + line;
  return {
    caption: message,
    mentions: [{ uid: String(activePlayer.uid), pos: String(caption || "").length + line.indexOf(tag), len: tag.length }]
  };
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
      ? "🎯 Đến lượt: " + (room.players.find(item => item.uid === room.turnUid)?.name || "Người chơi") + " (60s)"
      : "🏁 Ván đã kết thúc.";
  return [
    "🃏 BÀN CHƠI TIẾN LÊN MIỀN NAM #" + room.id,
    "",
    "👑 Chủ phòng: " + room.ownerName,
    room.practice
      ? "🧠 Luyện tập với 3 AI • Không cược xu"
      : "💰 Mức cược: " + formatMoney(room.bet) + " • 📜 Chế độ: " + modeLabel(room.mode),
    turn,
    ...(room.status === "waiting" ? ["⏱️ Bàn tự hủy sau 60 giây nếu chưa đủ người."] : []),
    "",
    ...players,
    "",
    current,
    notice,
    room.status === "waiting"
      ? "👉 Nhắn join " + room.id + " để vào bàn ngay!"
      : "💡 Gửi lá bài trong nhóm để đánh • chon 1,2 chọn theo số trên ảnh • goiy/auto hỗ trợ đánh nhanh • bo để bỏ lượt."
  ].filter(Boolean).join("\n");
}

async function renderImage(api, kind, key, threadId, type, data, caption, fallbackText) {
  let imagePath = null;
  try {
    imagePath = await renderCanvas("tlmn", data, { timeout: 20000, poolSize: 1 });
    const payload = { msg: caption, attachments: [imagePath], recallAfterMs: 0, ttlKind: "card" };
    if (kind === "group") {
      return await sendReplacement(api, key, threadId, type,
        rawApi => rawApi.sendMessage(withRequesterMention(
        data.event,
        data.mentions?.length ? { ...payload, mentions: data.mentions } : payload
      ), threadId, type));
    }
    return await sendReplacement(api, key, threadId, type,
      rawApi => rawApi.sendMessage(payload, threadId, type));
  } catch (error) {
    console.error("[TLMN_CANVAS]", error?.stack || error);
    const rawApi = getRawApi(api);
    try {
      if (kind === "group") return await rawApi.sendMessage(withRequesterMention(
        data.event,
        data.mentions?.length
          ? { msg: fallbackText || caption, mentions: data.mentions }
          : { msg: fallbackText || caption }
      ), threadId, type);
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
  const players = await Promise.all((room.players || []).map(async item => {
    if (item.ai || isAiUid(item.uid)) return item;
    const profile = await getRequesterProfile(api, {
      data: { uidFrom: item.uid, dName: item.name }
    }, { waitMs: 350, skipAvatarWarm: true });
    return { ...item, avatarUrl: profile?.requesterAvatarUrl || "" };
  }));
  const displayRoom = { ...room, players };
  const turnTag = buildTurnMentionCaption(displayRoom, tableCaption(displayRoom, notice));
  return renderImage(
    api, "group", "group:" + room.threadId, room.threadId, event.type,
    { view: "table", room: displayRoom, event, mentions: turnTag.mentions },
    turnTag.caption,
    turnTag.caption
  );
}

async function recallOrphanPrivateCards(api, uid, currentRoomId) {
  const rawApi = getRawApi(api);
  const playerId = String(uid);
  for (const [key, targets] of [...privateCards.entries()]) {
    if (!key.startsWith("hand:")) continue;
    const parts = key.split(":");
    const roomId = parts[1];
    const targetUid = parts[2];
    if (targetUid !== playerId || roomId === String(currentRoomId)) continue;
    // Keep cards only while this player is still active in the old room.
    // A forfeit/finished player must not retain stale private hand cards.
    const oldRoom = game.getByCode(roomId);
    const stillInOldGame = oldRoom && oldRoom.status !== "finished" &&
      (oldRoom.status === "waiting"
        ? oldRoom.players.some(item => item.uid === playerId)
        : oldRoom.activeUids.includes(playerId));
    if (stillInOldGame) continue;
    let failed;
    try {
      const destination = privateDestination(api, playerId);
      failed = await recallMessages(rawApi, destination.threadId, destination.type, targets);
    } catch (error) {
      console.warn("[TLMN_RECALL]", error?.message || error);
      failed = targets;
    }
    if (failed.length) privateCards.set(key, failed);
    else privateCards.delete(key);
  }
}

async function recallPrivateHand(api, room, uid) {
  const playerId = String(uid);
  const key = "hand:" + room.id + ":" + playerId;
  const targets = privateCards.get(key) || room.messageCards?.private?.[playerId] || [];
  const destination = privateDestination(api, playerId);
  const failed = await recallMessages(getRawApi(api), destination.threadId, destination.type, targets);
  if (failed.length) {
    privateCards.set(key, failed);
    if (room.messageCards?.private) room.messageCards.private[playerId] = failed;
  } else {
    forgetCards(key);
    if (room.messageCards?.private) delete room.messageCards.private[playerId];
  }
  return failed.length === 0;
}

async function sendPrivateHand(api, room, item, hand, turn = false) {
  if (item?.ai || isAiUid(item?.uid)) return true;
  await recallOrphanPrivateCards(api, item.uid, room.id);
  const destination = privateDestination(api, item.uid);
  const key = "hand:" + room.id + ":" + item.uid;
  const suitNames = { b: "Bích", ch: "Chuồn", r: "Rô", c: "Cơ" };
  const suitCodes = { b: "b", ch: "ch", r: "r", c: "c" };
  const codeCards = hand.map(card =>
    engine.rankLabel(card.rank).toLowerCase() + suitCodes[card.suit]
  ).join("  ");
  const namedCards = hand.map(card =>
    engine.rankLabel(card.rank) + suitNames[card.suit]
  ).join(", ");
  const adminHand = isAdmin(item.uid);
  const caption = [
    adminHand
      ? "👑 BÀI HOÀNG GIA CỦA ADMIN (" + hand.length + " lá):"
      : "🃏 BÀI TRÊN TAY CỦA BẠN (" + hand.length + " lá):",
    ...(destination.myDocuments ? ["📁 Đã lưu vào My Documents của tài khoản bot."] : []),
    "👑 " + String(item.name || "Người chơi").toUpperCase(),
    "",
    "👉 " + codeCards,
    "(" + namedCards + ")",
    "",
    turn ? "🎯 ĐẾN LƯỢT BẠN — hãy đánh bài hoặc bỏ lượt." : "🔒 Chỉ bạn nhìn thấy các lá bài này.",
    "",
    "⚡ LỆNH ĐÁNH NHANH GỢI Ý:",
    "• Chọn theo số trên ảnh: chon 1 hoặc chon 1,2,3 (từ trái sang phải)",
    "• goiy: gợi ý riêng • auto: tự đánh bộ hợp lệ để xả nhiều lá",
    "• Đánh lẻ: 4r, 10b, jc, 2c",
    "• Đôi: Đôi 3 (doi 3), Đôi 4 (doi 4), Đôi K (doi k)",
    "• Sám cô: sam 7 / sam co 7",
    "• Đôi thông: 3 đôi thông (3dt / doithong 345), 4 đôi thông (4dt / doithong 3456)",
    "• Sảnh: sanh 345, sanh 10-j-q, sanh jqk",
    "• Tứ quý: tuquy 4",
    "• Bỏ lượt: bo / pass",
    "",
    "♠ Bích (b) • ♣ Chuồn (ch) • ♦ Rô (r) • ♥ Cơ (c)",
    "💡 Có thể gõ có dấu hoặc không dấu."
  ].join("\n");
  const fallback = caption + "\n\n" + codeCards + "\n(" + namedCards + ")";
  const rawApi = getRawApi(api);
  let imagePath = null;
  let delivered = false;
  try {
    imagePath = await renderCanvas("tlmn", {
      view: "hand",
      room: { id: room.id, bet: room.bet, mode: room.mode },
      player: item,
      hand: hand.map(card => ({ ...card })),
      isTurn: turn,
      isAdmin: adminHand
    }, { timeout: 20000, poolSize: 1 });
    const response = await sendReplacement(api, key, destination.threadId, destination.type, rawApiInstance =>
      rawApiInstance.sendMessage({ msg: caption, attachments: [imagePath], recallAfterMs: 0, ttlKind: "card" },
        destination.threadId, destination.type));
    if (recallTargets(response).length) {
      delivered = true;
    } else {
      // A successful-looking API call without message IDs cannot be safely
      // recalled later. Send a text-only hand so the player is not left blind.
      const fallbackResponse = await rawApi.sendMessage(
        { msg: fallback }, destination.threadId, destination.type
      );
      delivered = Boolean(fallbackResponse);
    }
  } catch (error) {
    console.error("[TLMN_PRIVATE_HAND]", error?.stack || error);
    try {
      await rawApi.sendMessage({ msg: fallback }, destination.threadId, destination.type);
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

function scheduleRoomTurn(api, Users, Threads, room) {
  if (!room || room.status !== "playing" || !room.turnUid) return false;
  return game.watchTurn(room.threadId, ({ uid, player, playedCount }) =>
    withRoomActionLock(room.threadId, async () => {
      const current = game.get(room.threadId);
      if (!current || current !== room || current.status !== "playing" ||
          current.turnUid !== uid || current.playedCount !== playedCount) return;

      const action = game.timeoutTurn(room.threadId, uid);
      if (!action.ok) {
        console.warn("[TLMN_TIMEOUT]", action.code);
        return;
      }
      const syntheticEvent = {
        threadId: room.threadId, type: ThreadType.Group,
        data: { uidFrom: uid, dName: player?.name || "Người chơi" }
      };
      if (action.finished) {
        await endGame(api, syntheticEvent, Users, action.state, Threads);
        return;
      }
      if (action.action === "play") {
        const actor = action.state.players.find(item => item.uid === uid);
        await sendGroupRoom(api, syntheticEvent, action.room,
          "⏰ " + (player?.name || "Người chơi") + " quá 60 giây; bot tự đánh " +
          engine.formatCards(action.combo.cards) + ".");
        if (actor) await sendPrivateHand(api, action.state, actor, action.state.hands[uid] || [], false);
      } else {
        await sendGroupRoom(api, syntheticEvent, action.room,
          "⏰ " + (player?.name || "Người chơi") + " quá 60 giây; bot tự động bỏ lượt.");
        const passer = action.state.players.find(item => item.uid === uid);
        if (passer) await sendPrivateHand(api, action.state, passer, action.state.hands[uid] || [], false);
      }
      const next = action.state.players.find(item => item.uid === action.state.turnUid);
      if (next) {
        await sendPrivateHand(api, action.state, next, action.state.hands[next.uid] || [], true);
      }
      if (!await persistRoom(Threads, room.threadId)) {
        console.error("[TLMN_TIMEOUT] Không lưu được trạng thái sau lượt tự động.");
        return;
      }
      scheduleRoomTurn(api, Users, Threads, action.state);
      scheduleAiTurn(api, Users, Threads, action.state);
    })
  );
}


function chooseAiMove(room, uid) {
  const hand = room?.hands?.[String(uid)] || [];
  if (!hand.length) return null;

  const mustContainThreeOfSpades = Number(room.playedCount) === 0;
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  // A 13-card hand has only 8,191 non-empty subsets, so exhaustive legal
  // candidate checking is cheap and avoids AI moves that break game rules.
  const limit = 1 << hand.length;
  for (let mask = 1; mask < limit; mask += 1) {
    const cards = [];
    for (let index = 0; index < hand.length; index += 1) {
      if (mask & (1 << index)) cards.push(hand[index]);
    }
    if (mustContainThreeOfSpades && !cards.some(card => card.id === "3b")) continue;

    const validation = engine.validatePlay(hand, cards, room.currentCombo || null, {
      mustContainThreeOfSpades
    });
    if (!validation.ok) continue;

    const combo = validation.combo;
    const leadPenalty = room.currentCombo ? 0 : (cards.length === 1 ? 0 : cards.length * 100);
    const score = leadPenalty + cards.length * 10 + combo.mainRank * 3 + combo.highSuit;
    if (score < bestScore) {
      bestScore = score;
      best = {
        cards: combo.cards.map(card => ({ ...card })),
        input: combo.cards.map(engine.cardCode).join(" "),
        combo,
        score
      };
    }
  }
  return best;
}

function chooseQuickMove(room, uid) {
  const hand = room?.hands?.[String(uid)] || [];
  if (!hand.length) return null;
  const mustContainThreeOfSpades = Number(room.playedCount) === 0;
  const priorities = { pairRun: 90, straight: 75, fourKind: 70, triple: 45, pair: 30, single: 10 };
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  // Explore every subset of a 13-card hand, then keep the legal move that
  // sheds the most cards while preferring structured combinations.
  for (let mask = 1; mask < (1 << hand.length); mask += 1) {
    const cards = [];
    for (let index = 0; index < hand.length; index += 1) {
      if (mask & (1 << index)) cards.push(hand[index]);
    }
    if (mustContainThreeOfSpades && !cards.some(card => card.id === "3b")) continue;
    const validation = engine.validatePlay(hand, cards, room.currentCombo || null, {
      mustContainThreeOfSpades
    });
    if (!validation.ok) continue;
    const combo = validation.combo;
    const score = cards.length * 1000 + (priorities[combo.type] || 0) * 10 -
      combo.mainRank * 2 - combo.highSuit;
    if (score > bestScore) {
      bestScore = score;
      best = {
        cards: combo.cards.map(card => ({ ...card })),
        input: combo.cards.map(engine.cardCode).join(" "),
        combo,
        score
      };
    }
  }
  return best;
}

async function sendMoveHint(context) {
  const { api, event } = context;
  const uid = String(event?.data?.uidFrom || "");
  const room = game.get(String(event?.threadId || ""));
  if (!room || room.status !== "playing" || !room.activeUids.includes(uid)) return false;
  if (room.turnUid !== uid) {
    await sendMoveError(api, event, uid, "NOT_TURN", "⏳ Chưa đến lượt bạn.");
    return true;
  }
  const move = chooseQuickMove(room, uid);
  const message = move
    ? [
        "⚡ GỢI Ý NƯỚC ĐÁNH NHANH",
        "Bộ: " + engine.COMBO_LABEL[move.combo.type],
        "Lá: " + engine.formatCards(move.cards),
        "Lệnh: " + move.input,
        "Có thể gõ auto để bot đánh giúp hoặc tự chọn bằng chon 1,2."
      ].join("\n")
    : "⛔ Không có bộ hợp lệ để chặn. Bạn có thể gõ bo để bỏ lượt.";
  try {
    await sendPrivateNotice(api, uid, message);
  } catch (error) {
    console.warn("[TLMN_HINT]", error?.message || error);
    await sendMoveError(api, event, uid, "HINT_DELIVERY", "⚠️ Chưa gửi được gợi ý vào bài riêng.");
  }
  return true;
}

function clearAiTurn(threadId) {
  const key = String(threadId || "");
  const timer = aiTimers.get(key);
  if (timer) clearTimeout(timer);
  aiTimers.delete(key);
}

function scheduleAiTurn(api, Users, Threads, room) {
  if (!room || !room.practice || room.status !== "playing" || !isAiUid(room.turnUid)) {
    if (room?.threadId) clearAiTurn(room.threadId);
    return false;
  }
  const threadId = String(room.threadId);
  const uid = String(room.turnUid);
  const expectedPlayedCount = room.playedCount;
  const expectedToken = String(room.gameToken || room.id);
  clearAiTurn(threadId);

  const timer = setTimeout(() => {
    if (aiTimers.get(threadId) !== timer) return;
    aiTimers.delete(threadId);
    withRoomActionLock(threadId, async () => {
      const current = game.get(threadId);
      if (!current || current !== room || current.status !== "playing" ||
          !current.practice || current.turnUid !== uid ||
          current.playedCount !== expectedPlayedCount ||
          String(current.gameToken || current.id) !== expectedToken) return;

      const beforeMove = game.serialize(current);
      const move = chooseAiMove(current, uid);
      let action = move
        ? game.play(threadId, uid, move.input)
        : game.pass(threadId, uid);

      if (!action.ok && !move && !current.currentCombo) {
        action = game.timeoutTurn(threadId, uid);
      }
      if (!action.ok) {
        console.warn("[TLMN_AI] Không tìm được nước hợp lệ:", action.code);
        return;
      }

      if (!await persistRoom(Threads, threadId)) {
        const restored = game.restore(beforeMove);
        if (restored) {
          scheduleRoomTurn(api, Users, Threads, restored);
          scheduleAiTurn(api, Users, Threads, restored);
        }
        return;
      }

      const actor = current.players.find(item => item.uid === uid);
      const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
      if (action.finished) {
        await endGame(api, syntheticEvent, Users, action.state, Threads);
        return;
      }

      const notice = action.combo
        ? "🤖 " + (actor?.name || "AI") + " đánh " + engine.formatCards(action.combo.cards) + "."
        : "🤖 " + (actor?.name || "AI") + " bỏ lượt" +
          (action.roundCleared ? " • Vòng mới bắt đầu." : ".");
      await sendGroupRoom(api, syntheticEvent, action.room, notice);

      const human = current.players.find(item => !item.ai && !isAiUid(item.uid));
      if (human) {
        await sendPrivateHand(api, current, human, current.hands[human.uid] || [],
          current.turnUid === human.uid);
      }
      await persistRoom(Threads, threadId);
      scheduleRoomTurn(api, Users, Threads, current);
      scheduleAiTurn(api, Users, Threads, current);
    }).catch(error => console.error("[TLMN_AI]", error?.stack || error));
  }, 850);

  timer.unref?.();
  aiTimers.set(threadId, timer);
  return true;
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

function scheduleCleanupRetry(api, Threads, room) {
  const key = String(room.threadId);
  if (cleanupTimers.has(key)) return;
  const timer = setTimeout(async () => {
    if (cleanupTimers.get(key) !== timer) return;
    cleanupTimers.delete(key);
    const failures = await recallRoomCards(api, room);
    if (failures) {
      await persistRoom(Threads, key);
      scheduleCleanupRetry(api, Threads, room);
      return;
    }
    game.removeRoom(key);
    await persistRoom(Threads, key);
  }, 30000);
  timer.unref?.();
  cleanupTimers.set(key, timer);
}

async function finalizeRoomCleanup(api, Threads, room) {
  const failures = await recallRoomCards(api, room);
  if (failures) {
    await persistRoom(Threads, room.threadId);
    scheduleCleanupRetry(api, Threads, room);
    return false;
  }
  game.removeRoom(room.threadId);
  await persistRoom(Threads, room.threadId);
  return true;
}

async function endGame(api, event, Users, roomState, Threads) {
  const room = roomState;
  if (Threads && await persistRoom(Threads, room.threadId) === false) {
    await sendText(api, event, "⚠️ Chưa thể lưu kết quả ván bài vào database; xu chưa được chốt để tránh sai lệch số dư.");
    return;
  }
  if (room.practice) {
    room.settled = true;
    await persistRoom(Threads, room.threadId);
    await finalizeRoomCleanup(api, Threads, room);
    const rows = room.results || [];
    return sendText(api, event, [
      "🏁 KẾT THÚC VÁN LUYỆN TẬP VS AI #" + room.id,
      "",
      ...rows.map(row => (row.place === 1 ? "👑 " : "• ") +
        row.place + ". " + row.name + " — còn " + row.cardsLeft + " lá"),
      "",
      "🧠 Đây là ván luyện tập, không cộng hoặc trừ xu.",
      "👉 Gõ !tlmn ai để đấu lại với 3 AI."
    ].join("\n"));
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

  await finalizeRoomCleanup(api, Threads, room);
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

async function hasSavedRoom(Threads, threadId) {
  try {
    const record = Threads?.getCachedData?.(String(threadId)) ||
      await Threads?.getData?.(String(threadId));
    const data = record?.data && typeof record.data === "object" ? record.data : record;
    return Boolean(data?.tlmn_room);
  } catch {
    return true;
  }
}

async function createAiPractice(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const name = event?.data?.dName || event?.data?.name || "Admin";

  if (event?.type !== ThreadType.Group) {
    return sendText(api, event, "⚠️ Hãy dùng !tlmn ai trong nhóm để mở bàn luyện tập.");
  }
  if (!isAdmin(uid)) {
    return sendText(api, event, "⛔ Chế độ luyện tập với AI hiện chỉ dành cho Admin bot.");
  }
  if (!isEnabled(Threads, threadId)) {
    return sendText(api, event, "🚫 Game Tiến Lên đã tắt trong nhóm này.");
  }
  if (game.isBusy(threadId) || await hasSavedRoom(Threads, threadId)) {
    return sendText(api, event, "⚠️ Nhóm đang có bàn Tiến Lên hoặc dữ liệu bàn cần khôi phục. Hãy kết thúc bàn hiện tại trước.");
  }
  const conflict = gameConflict(threadId);
  if (conflict) {
    return sendText(api, event, "⚠️ Nhóm đang chơi game " + conflict + ". Hãy kết thúc game đó trước.");
  }

  const created = game.create(threadId, { uid, name }, {
    bet: 5000,
    practice: true,
    practiceWinnerUid: uid
  });
  if (!created.ok) {
    return sendText(api, event, "⚠️ Không thể tạo bàn luyện tập với AI.");
  }

  const bots = ["🤖 AI • Tân thủ", "🤖 AI • Chiến thuật", "🤖 AI • Cao thủ"];
  for (let index = 0; index < bots.length; index += 1) {
    const joined = game.join(threadId, created.state.id, {
      uid: AI_UID_PREFIX + created.state.id + ":" + (index + 1),
      name: bots[index],
      ai: true
    });
    if (!joined.ok) {
      game.removeRoom(threadId);
      await persistRoom(Threads, threadId);
      return sendText(api, event, "⚠️ Không thể thêm đủ 3 AI; bàn luyện tập đã được đóng.");
    }
  }

  if (!await persistRoom(Threads, threadId)) {
    game.removeRoom(threadId);
    await persistRoom(Threads, threadId);
    return sendText(api, event, "⚠️ Database chưa lưu được bàn luyện tập; vui lòng thử lại.");
  }
  await sendGroupRoom(api, event, game.snapshot(created.state),
    "🤖 Đã mở bàn luyện tập với 3 AI. Không cược xu; chỉ bài của bạn được gửi riêng.");
  return startRoom(context);
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

  if (await hasSavedRoom(Threads, threadId)) {
    return sendText(api, event, "⚠️ Nhóm đang có dữ liệu bàn Tiến Lên cần khôi phục. Bot giữ nguyên dữ liệu để tránh mất xu; quản trị viên hãy kiểm tra log TLMN_RECOVERY.");
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
  if (state.practice) {
    await sendText(api, event,
      "🧠 CHẾ ĐỘ LUYỆN TẬP: Không cược xu. Admin được chia bộ bài mạnh để thử chiến thuật; AI vẫn đánh chặn theo luật bình thường.");
  } else {
    await sendText(api, event, [
      "**JOHNTRAN** ❗",
      "🔔 LƯU Ý QUAN TRỌNG TRƯỚC KHI BẮT ĐẦU VÁN BÀI:",
      "Tất cả người chơi vui lòng KHÔNG CHẶN TIN NHẮN NGƯỜI LẠ với Bot, để Bot có thể chia bài và gửi ảnh các lá bài trên tay vào tin nhắn riêng cho bạn nhé!",
      "📩 Nếu chưa nhận được bài, hãy mở chat riêng với Bot và nhắn tin cho Bot trước."
    ].join("\n"));
  }
  const reserved = state.practice
    ? { ok: true, reserve: 0 }
    : await reserveRoomWallets(Users, state, () => persistRoom(Threads, threadId));
  if (!reserved.ok) {
    return sendText(api, event, reserved.storageError || reserved.refundPending
      ? "⚠️ Không thể xác nhận hoặc hoàn khoản giữ cược an toàn. Bàn chưa bắt đầu; dữ liệu đối soát được giữ lại."
      : "💸 " + reserved.player.name + " chưa đủ xu. Cần giữ trước " + formatMoney(reserved.required) + " (hiện có " + formatMoney(reserved.coins) + ").");
  }
  const result = game.start(threadId, uid);
  if (!result.ok) {
    const refunded = await refundRoomWallets(Users, state, () => persistRoom(Threads, threadId));
    await persistRoom(Threads, threadId);
    return sendText(api, event, refunded
      ? "⚠️ Không thể bắt đầu bàn; xu cược đã được hoàn."
      : "⚠️ Không thể bắt đầu bàn và việc hoàn cược vẫn đang đồng bộ. Bàn được giữ lại để khôi phục.");
  }

  const room = result.state;
  if (!await persistRoom(Threads, threadId)) {
    game.resetToWaiting(threadId);
    const refunded = await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId));
    await persistRoom(Threads, threadId);
    return sendText(api, event, refunded
      ? "⚠️ Database chưa lưu được ván mới. Bàn quay lại trạng thái chờ và xu đã được hoàn."
      : "⚠️ Database chưa xác nhận ván mới. Trạng thái giữ lại để đối soát cược.");
  }
  const failedPrivate = await distributeHands(api, room);
  if (failedPrivate.length) {
    await recallRoomCards(api, room);
    game.resetToWaiting(threadId);
    const refunded = await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId));
    await persistRoom(Threads, threadId);
    await sendGroupRoom(api, event, game.snapshot(room),
      "🚫 Không gửi được bài riêng cho " + failedPrivate.join(", ") +
      ". Ván đã hủy để bảo vệ bài; " +
      (room.practice ? "đây là ván luyện tập nên không có xu cược." :
        refunded ? "xu cược đã hoàn." : "khoản hoàn cược đang được đồng bộ.") +
      " Người chơi hãy mở chat riêng với bot và bật nhận tin nhắn người lạ, sau đó chủ phòng có thể start lại.");
    return;
  }
  await sendGroupRoom(api, event, result.room,
    room.practice
      ? "🎮 Đã chia bài luyện tập cho Admin. AI sẽ tự tìm nước đánh hợp lệ, không tự động nhường lượt."
      : "🎮 Đã chia 13 lá riêng cho từng người. Người có 3♠ đi trước.");
  await persistRoom(Threads, threadId);
  scheduleRoomTurn(api, Users, Threads, room);
  scheduleAiTurn(api, Users, Threads, room);
}

async function doPlay(context, input) {
  const { api, event, Users, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const state = game.get(threadId);
  if (!state || state.status !== "playing") return false;

  const beforeMove = game.serialize(state);
  const result = game.play(threadId, uid, input);
  if (!result.ok) {
    const errors = {
      NOT_PLAYER: "⚠️ Bạn không tham gia bàn này.",
      NOT_TURN: "⏳ Chưa đến lượt bạn.",
      UNRECOGNIZED_PLAY: "⚠️ Không hiểu cách đánh. Ví dụ: 4b, doi 4, sanh 4567, tuquy 4.",
      INVALID_SELECTION: "⚠️ Số lá không hợp lệ. Dùng chon 1 hoặc chon 1,2 theo số trên ảnh.",
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
    if (errors[result.code]) await sendMoveError(
      api, event, uid, result.code, errors[result.code]
    );
    return true;
  }

  const room = result.state;
  if (!await persistRoom(Threads, threadId)) {
    game.restore(beforeMove);
    scheduleRoomTurn(api, Users, Threads, game.get(threadId));
    await sendText(api, event, "⚠️ Database chưa xác nhận nước đi. Ván được giữ nguyên; vui lòng thử lại.");
    return true;
  }
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
  }
  await persistRoom(Threads, threadId);
  scheduleRoomTurn(api, Users, Threads, room);
  scheduleAiTurn(api, Users, Threads, room);
  return true;
}

async function doPass(context) {
  const { api, event, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const beforePass = game.serialize(game.get(threadId));
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
  if (!await persistRoom(Threads, threadId)) {
    game.restore(beforePass);
    scheduleRoomTurn(api, context.Users, Threads, game.get(threadId));
    await sendText(api, event, "⚠️ Database chưa xác nhận lượt bỏ. Ván được giữ nguyên; vui lòng thử lại.");
    return true;
  }
  const passer = result.state.players.find(item => item.uid === uid);
  if (passer) await sendPrivateHand(api, result.state, passer, result.state.hands[uid] || [], false);
  const next = result.state.players.find(item => item.uid === result.state.turnUid);
  await sendGroupRoom(api, event, result.room,
    "↪️ " + (event?.data?.dName || event?.data?.name || "Người chơi") + " đã bỏ lượt" +
    (result.roundCleared ? " • Vòng mới bắt đầu." : "."));
  if (next) {
    await sendPrivateHand(api, result.state, next, result.state.hands[next.uid] || [], true);
  }
  await persistRoom(Threads, threadId);
  scheduleRoomTurn(api, context.Users, Threads, result.state);
  scheduleAiTurn(api, context.Users, Threads, result.state);
  return true;
}
 
async function doLeave(context) {
  const { api, event, Users, Threads } = context;
  const threadId = String(event?.threadId || "");
  const uid = String(event?.data?.uidFrom || "");
  const state = game.get(threadId);
  if (!state) return sendText(api, event, "⚠️ Bạn chưa ở trong bàn Tiến Lên.");
  const result = game.leave(threadId, uid);
  if (!result.ok) return sendText(api, event, "⚠️ Bạn không ở trong bàn này.");
  if (result.finished) return endGame(api, event, Users, result.state, context.Threads);
  if (state.status === "playing") await recallPrivateHand(api, state, uid);
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
  await persistRoom(Threads, threadId);
  if (result.state.status === "playing") {
    scheduleRoomTurn(api, Users, Threads, result.state);
    scheduleAiTurn(api, Users, Threads, result.state);
  }
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

  if (action === "ai" || action === "vsai" || action === "bot") return createAiPractice(context);
  if (action === "go") return createOrJoin(context);
  if (action === "join") return joinRoom(context, rest[0]);
  if (action === "start") return startRoom(context);
  if (action === "leave") return doLeave(context);
  if (action === "stop") {
    const room = game.get(threadId);
    if (!room) return sendText(api, event, "⚠️ Không có bàn Tiến Lên.");
    if (room.ownerId !== uid) return sendText(api, event, "⛔ Chỉ chủ phòng mới được hủy bàn.");

    if (room.status === "playing") {
      room.cancelPending = true;
      if (!await persistRoom(Threads, threadId)) {
        return sendText(api, event, "⚠️ Database chưa lưu được yêu cầu hủy; ván vẫn giữ nguyên.");
      }
      if (!await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId))) {
        await persistRoom(Threads, threadId);
        return sendText(api, event, "⚠️ Chưa hoàn cược được đầy đủ; bàn vẫn được giữ để thử lại.");
      }
      game.finishRoom(room);
      room.settled = true;
      room.cancelPending = false;
      const cleaned = await finalizeRoomCleanup(api, Threads, room);
      return sendText(api, event, "🛑 Đã hủy bàn #" + room.id +
        (cleaned ? ". Xu cược đã được hoàn và card đã thu hồi." : ". Xu đã hoàn; bot đang thử thu hồi card cũ."));
    }

    const roomId = room.id;
    const cleaned = await finalizeRoomCleanup(api, Threads, room);
    return sendText(api, event, "🛑 Đã hủy bàn #" + roomId +
      (cleaned ? "." : ". Bot đang thử thu hồi card cũ."));
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
        if (room.status === "playing") {
          room.cancelPending = true;
          if (!await persistRoom(Threads, threadId)) {
            return sendText(api, event, "⚠️ Database chưa lưu được yêu cầu tắt/hủy; ván vẫn được giữ nguyên.");
          }
          if (!await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId))) {
            await persistRoom(Threads, threadId);
            return sendText(api, event, "⚠️ Chưa thể hoàn cược an toàn; trạng thái bàn được giữ để thử lại.");
          }
          game.finishRoom(room);
          room.settled = true;
          room.cancelPending = false;
          await finalizeRoomCleanup(api, Threads, room);
        } else {
          await finalizeRoomCleanup(api, Threads, room);
        }
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
    const rows = (Users.getAll?.() || []).filter(row =>
      row?.data?.tlmn && Number.isSafeInteger(Number(row.data.tlmn.coins))
    ).map(row => {
      const wallet = normalizeWallet(row.data);
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
    const eventId = String(event?.data?.msgId || event?.data?.cliMsgId || crypto.randomUUID());
    const transferId = uid + ":" + eventId;
    const target = firstMention(event?.data || {});
    const amount = parseAmount(rest[rest.length - 1]);
    if (!target || !amount) return sendText(api, event, "⚠️ Dùng: !tlmn " + action + " @user 10k.");
    if (target === uid) return sendText(api, event, "⚠️ Không thể chuyển xu cho chính mình.");
    if (action === "nap" && !isAdmin(uid)) return sendText(api, event, "⛔ Chỉ Spadmin/Admin bot mới được nạp xu.");

    if (action === "pay") {
      await reconcilePendingTransfers(Users);
      const wallet = await readWallet(Users, uid);
      if (wallet.pendingTransfers.length) {
        return sendText(api, event, "⏳ Bạn đang có giao dịch chờ đồng bộ. Vui lòng đợi bot xử lý xong trước khi chuyển tiếp.");
      }
      const sender = await changeWallet(
        Users, uid, -amount, "pay-out:" + transferId,
        { mutateData(data, currentWallet) {
          currentWallet.pendingTransfers.push({
            id: transferId, target, amount, createdAt: Date.now()
          });
          currentWallet.pendingTransfers = currentWallet.pendingTransfers.slice(-50);
          data.tlmn = currentWallet;
        }}
      );
      if (!sender.ok) return sendText(api, event, "💸 Bạn không đủ xu để chuyển " + formatMoney(amount) + ".");
    }

    try {
      const receiver = await changeWallet(
        Users, target, amount,
        (action === "nap" ? "admin-nap:" : "pay-in:") + transferId
      );
      if (!receiver.ok) {
        return sendText(api, event, action === "pay"
          ? "⏳ Giao dịch đã lưu chờ xử lý. Không gửi lại lệnh."
          : "❌ Không thể cập nhật ví người nhận; vui lòng thử lại sau.");
      }
      if (action === "pay") {
        const finalized = await changeWallet(
          Users, uid, 0, "pay-settled:" + transferId,
          { mutateData(data, currentWallet) {
            currentWallet.pendingTransfers = currentWallet.pendingTransfers.filter(
              item => String(item?.id || "") !== transferId
            );
            data.tlmn = currentWallet;
          }}
        );
        if (!finalized.ok) {
          return sendText(api, event, "⏳ Người nhận đã được cộng xu; bot đang hoàn tất biên nhận, không cần gửi lại lệnh.");
        }
      }
    } catch (error) {
      console.error("[TLMN_TRANSFER]", error?.stack || error);
      return sendText(api, event, action === "pay"
        ? "⏳ Giao dịch đã lưu chờ xử lý. Bot sẽ tự đồng bộ khi database ổn định; không gửi lại lệnh."
        : "❌ Không thể cập nhật ví người nhận; vui lòng thử lại sau.");
    }
    return sendText(api, event, (action === "nap" ? "✅ Đã nạp " : "✅ Đã chuyển ") +
      formatMoney(amount) + " cho người chơi.");
  }
  return sendText(api, event, help(prefix));
}

async function handleIncoming(context = {}) {
  const { api, event, isSelf, Threads } = context;
  if ((isSelf || event?.isSelf) && global.config?.allow_self_command !== true) return false;
  const content = String(event?.data?.content || "").trim();
  const prefix = String(global.config?.prefix || "!");
  if (!content || content.startsWith(prefix) || event?.type !== ThreadType.Group) return false;
  const lower = engine.normalizeText(content);
  const threadId = String(event?.threadId || "");
  const room = game.get(threadId);
  if (!isEnabled(Threads, threadId)) return false;

  if (lower === "go" && (!room || room.status === "waiting")) {
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
  if (room.status === "playing" && room.activeUids.includes(String(event?.data?.uidFrom || ""))) {
    if (["goi y", "goiy", "hint", "suggest"].includes(lower)) {
      await sendMoveHint(context);
      return true;
    }
    if (["auto", "danh nhanh", "ra nhanh", "tu dong"].includes(lower)) {
      const uid = String(event?.data?.uidFrom || "");
      if (room.turnUid !== uid) {
        await sendMoveError(api, event, uid, "NOT_TURN", "⏳ Chưa đến lượt bạn.");
        return true;
      }
      const move = chooseQuickMove(room, uid);
      if (!move) {
        await sendMoveError(api, event, uid, "NO_AUTO_MOVE", "⛔ Không tìm được nước đánh hợp lệ; hãy gõ bo nếu được phép.");
        return true;
      }
      await doPlay(context, move.input);
      return true;
    }
    if (["bo", "pass", "skip"].includes(lower)) {
      await doPass(context);
      return true;
    }
    const hasCardSyntax = /(10|[3-9]|[jqka2])(ch|dt|b|r|c|t)/i.test(lower) ||
      /^(doi(\s*thong)?|doithong|pair|double|sam(\s*co)?|triple|tu\s*quy|tuquy|four|sanh|straight|le|single)\b/.test(lower) ||
      /^(chon|select|vi\s*tri|vitri)\b/.test(lower);
    if (hasCardSyntax) {
      await doPlay(context, content);
      return true;
    }
  }
  return false;
}

module.exports.run = context => withRoomActionLock(
  context?.event?.threadId,
  () => runCommand(context)
);
module.exports.handleIncoming = context => withRoomActionLock(
  context?.event?.threadId,
  () => handleIncoming(context)
);

module.exports.onLoad = async function ({ api, Users, Threads } = {}) {
  if (!Threads?.getAll) return;
  await reconcilePendingTransfers(Users).catch(error =>
    console.error("[TLMN_TRANSFER_RECOVERY]", error?.stack || error)
  );

  const records = Threads.getAll() || [];
  for (const record of records) {
    const threadId = String(record?.threadId || record?.id || "");
    const saved = record?.data?.tlmn_room;
    if (!threadId || !saved) continue;

    const room = game.restore(saved);
    if (!room) {
      console.error("[TLMN_RECOVERY] Dữ liệu bàn không hợp lệ, giữ nguyên để đối soát:", threadId);
      const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
      await sendText(api, syntheticEvent,
        "⚠️ Dữ liệu bàn Tiến Lên cần quản trị viên kiểm tra. Bot giữ nguyên dữ liệu và không cho mở bàn mới để tránh mất xu.");
      continue;
    }
    restoreRoomCards(room);

    if (room.status === "waiting") {
      const refunded = await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId));
      if (!refunded || !await persistRoom(Threads, threadId)) {
        console.error("[TLMN_RECOVERY] Chưa hoàn xong cược bàn chờ #" + room.id);
        continue;
      }
      game.watchLobby(threadId, async () => {
        await recallRoomCards(api, room);
        game.removeRoom(threadId);
        await persistRoom(Threads, threadId);
        const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
        await sendText(api, syntheticEvent, "⌛ Bàn Tiến Lên #" + room.id + " tự hủy sau 60 giây vì không đủ người chơi.");
      });
      continue;
    }

    if (room.status === "playing" && room.cancelPending) {
      const refunded = await refundRoomWallets(Users, room, () => persistRoom(Threads, threadId));
      if (!refunded) {
        console.error("[TLMN_RECOVERY] Hủy bàn #" + room.id + " nhưng hoàn cược còn chờ.");
        continue;
      }
      game.finishRoom(room);
      room.settled = true;
      room.cancelPending = false;
      const cleaned = await finalizeRoomCleanup(api, Threads, room);
      if (cleaned) {
        const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
        await sendText(api, syntheticEvent, "🛑 Bot đã khôi phục yêu cầu hủy bàn #" + room.id + " và hoàn cược.");
      }
      continue;
    }

    if (room.status === "playing") {
      const failedPrivate = await distributeHands(api, room);
      const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
      await sendGroupRoom(api, syntheticEvent, game.snapshot(room),
        "🔄 Bot đã khôi phục ván sau khi khởi động lại." +
        (failedPrivate.length ? "\n⚠️ Chưa gửi lại được bài riêng cho: " + failedPrivate.join(", ") + "." : ""));
      const current = room.players.find(item => item.uid === room.turnUid);
      if (!await persistRoom(Threads, threadId)) continue;
      scheduleRoomTurn(api, Users, Threads, room);
      scheduleAiTurn(api, Users, Threads, room);
      continue;
    }

    if (room.status === "finished") {
      if (!room.settled) {
        const syntheticEvent = { threadId, type: ThreadType.Group, data: {} };
        await endGame(api, syntheticEvent, Users, room, Threads);
      } else {
        await finalizeRoomCleanup(api, Threads, room);
      }
    }
  }
};

module.exports._test = {
  parseAmount, formatMoney, normalizeWallet, tierForCoins,
  isAiUid, privateDestination, sendPrivateHand, chooseAiMove, chooseQuickMove,
  shouldSendMoveError, sendMoveHint, scheduleAiTurn, tableCaption, buildTurnMentionCaption, recallTargets, reserveRoomWallets, refundRoomWallets,
  reconcilePendingReservations, reconcilePendingTransfers,
  settleRoomWallets, readWallet, changeWallet, getRawApi,
  finalizeRoomCleanup, recallRoomCards, recallPrivateHand, withRoomActionLock
};
