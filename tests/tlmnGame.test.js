"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { ThreadType } = require("zalo-client");

const rendererPath = require.resolve("../core/canvas/workerRender");
require.cache[rendererPath] = {
  id: rendererPath, filename: rendererPath, loaded: true,
  exports: { renderCanvas: async () => "/tmp/tlmn-test-card.png" }
};

const engine = require("../core/games/tlmnEngine");
const game = require("../core/runtime/services/games/tlmnService");
const command = require("../plugins/commands/tlmn");

test("Tiến Lên: cảnh báo trước khi start, bài chỉ gửi riêng và có hướng dẫn mã lá", async () => {
  const sent = [];
  let sequence = 0;
  const api = {
    async sendMessage(payload, threadId, type) {
      const msgId = "test-" + (++sequence);
      sent.push({ payload, threadId: String(threadId), type, msgId });
      return { message: { msgId, cliMsgId: "cli-" + msgId } };
    },
    async undo() { return true; }
  };
  const userRows = new Map();
  const threadRows = new Map();
  const Users = {
    async getData(uid) { return { data: userRows.get(String(uid)) || {} }; },
    async setData(uid, data) { userRows.set(String(uid), data); },
    getAll() { return [...userRows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const Threads = {
    async getData(id) { return { data: threadRows.get(String(id)) || {} }; },
    async setData(id, data) { threadRows.set(String(id), data); },
    async setDataAndWait(id, data) { threadRows.set(String(id), data); },
    getCachedData(id) { return { data: threadRows.get(String(id)) || {} }; }
  };
  global.config = { prefix: "!" };
  global.users = {};
  const group = { threadId: "tlmn-test-group", type: ThreadType.Group, data: { uidFrom: "owner", dName: "Wuang" } };
  try {
    await command.run({ args: ["go"], api, event: group, Users, Threads });
    const room = game.get(group.threadId);
    assert.ok(room);
    await command.handleIncoming({
      api, Users, Threads,
      event: { ...group, data: { uidFrom: "guest", dName: "A Sìn", content: "join " + room.id } }
    });
    await command.handleIncoming({
      api, Users, Threads,
      event: { ...group, data: { uidFrom: "owner", dName: "Wuang", content: "start" } }
    });

    const warningIndex = sent.findIndex(row => String(row.payload.msg || "").includes("KHÔNG CHẶN TIN NHẮN NGƯỜI LẠ"));
    assert.ok(warningIndex >= 0, "the group warning is sent");
    const privateImages = sent.filter(row => row.type === ThreadType.User && Array.isArray(row.payload.attachments));
    assert.equal(privateImages.length, 2, "one private hand image per player");
    assert.ok(privateImages.every(row => row.threadId !== group.threadId));
    assert.ok(privateImages.every(row => String(row.payload.msg).includes("BÀI TRÊN TAY CỦA BẠN")));
    assert.ok(privateImages.every(row => String(row.payload.msg).includes("LỆNH ĐÁNH NHANH GỢI Ý")));
    assert.ok(privateImages.every(row => /👉 [3456789]|👉 10|👉 J|👉 Q|👉 K|👉 A|👉 2/.test(String(row.payload.msg))));
    const groupPayloads = sent.filter(row => row.threadId === group.threadId);
    assert.equal(groupPayloads.some(row => String(row.payload.msg || "").includes("BÀI TRÊN TAY CỦA BẠN")), false);
    assert.ok(warningIndex < sent.findIndex(row => row.type === ThreadType.User && Array.isArray(row.payload.attachments)));
  } finally {
    game.removeRoom(group.threadId);
    delete require.cache[rendererPath];
  }
});

test("Tiến Lên engine: 52 lá và chia 13 lá cho 2–4 người", () => {
  const deck = engine.createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(card => card.id)).size, 52);
  for (const count of [2, 3, 4]) {
    const ids = Array.from({ length: count }, (_, index) => "p" + index);
    const dealt = engine.dealCards(ids, () => 0.37);
    assert.ok(ids.every(uid => dealt.hands[uid].length === 13));
    assert.ok(dealt.hands[dealt.firstPlayerId].some(card => card.id === "3b"));
  }
});


test("TLMN engine: rank 2 codes parse as the high card, not rank 2", () => {
  for (const code of ["2b", "2ch", "2r", "2c"]) {
    const card = engine.parseCardCode(code);
    assert.ok(card, code);
    assert.equal(card.rank, 15, code);
  }
});

test("TLMN engine: 3dt and 4dt parse as consecutive pair runs", () => {
  const deck = engine.createDeck();
  for (const [input, pairCount] of [["3dt", 3], ["4dt", 4]]) {
    const parsed = engine.parsePlayText(deck, input);
    assert.equal(parsed.ok, true, input);
    assert.equal(parsed.cards.length, pairCount * 2, input);
    assert.equal(engine.analyzeCombo(parsed.cards).type, "pairRun", input);
  }
});

test("TLMN engine: sam 7 / sám cô 7 parse as a triple", () => {
  for (const input of ["sam 7", "sám 7", "sam co 7"]) {
    const parsed = engine.parsePlayText(engine.createDeck(), input);
    assert.equal(parsed.ok, true, input);
    assert.equal(parsed.cards.length, 3, input);
    assert.equal(engine.analyzeCombo(parsed.cards).type, "triple", input);
  }
});

test("TLMN engine: all direct card examples parse", () => {
  for (const code of ["3b", "3ch", "3t", "4r", "10b", "jb", "qc", "kr", "kc", "ac", "2c"]) {
    assert.ok(engine.parseCardCode(code), code);
  }
  assert.equal(engine.parseCardCode("3t").suit, "ch");
});

test("TLMN service: timeout automatically plays 3b on the opening turn", () => {
  const groupId = "tlmn-timeout-opening";
  const created = game.create(groupId, { uid: "owner", name: "Owner" });
  assert.equal(created.ok, true);
  assert.equal(game.join(groupId, created.room.id, { uid: "guest", name: "Guest" }).ok, true);
  const started = game.start(groupId, "owner", () => 0.37);
  assert.equal(started.ok, true);
  const firstUid = started.firstPlayerId;
  const timeout = game.timeoutTurn(groupId, firstUid);
  assert.equal(timeout.ok, true);
  assert.equal(timeout.action, "play");
  assert.ok(timeout.combo.cards.some(card => card.id === "3b"));
  game.removeRoom(groupId);
});

test("TLMN service: leaving removes stale pass state and preserves a playable turn", () => {
  const groupId = "tlmn-leave-pass";
  const created = game.create(groupId, { uid: "p1" });
  game.join(groupId, created.room.id, { uid: "p2" });
  game.join(groupId, created.room.id, { uid: "p3" });
  game.start(groupId, "p1", () => 0.37);
  const room = game.get(groupId);
  const leaver = room.turnUid === "p2" ? "p2" : "p3";
  room.passed.add(leaver);
  const result = game.leave(groupId, leaver);
  assert.equal(result.ok, true);
  assert.equal(room.passed.has(leaver), false);
  assert.ok(room.turnUid);
  game.removeRoom(groupId);
});

test("TLMN service: serialize/restore preserves reservation intents and card IDs", () => {
  const groupId = "tlmn-restore-lock";
  const created = game.create(groupId, { uid: "p1" });
  game.join(groupId, created.room.id, { uid: "p2" });
  game.start(groupId, "p1", () => 0.37);
  const room = game.get(groupId);
  room.lockTransactionId = "lock-id";
  room.lockPending.p1 = { amount: 5000, transactionId: "reserve-tx" };
  room.messageCards.group = [{ msgId: "group-msg", cliMsgId: "group-cli" }];
  const saved = game.serialize(room);
  game.removeRoom(groupId);
  const restored = game.restore(saved);
  assert.ok(restored);
  assert.equal(restored.lockPending.p1.transactionId, "reserve-tx");
  assert.equal(restored.messageCards.group[0].msgId, "group-msg");
  assert.equal(restored.hands.p1.length, 13);
  game.removeRoom(groupId);
});

test("TLMN wallets: update transactions through the durable user service when available", async () => {
  const rows = new Map();
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); },
    getAll() { return [...rows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const wallet = await command._test.readWallet(Users, "wallet-user");
  assert.equal(wallet.coins, 100000);
  const changed = await command._test.changeWallet(
    Users, "wallet-user", -5000, "test-reserve-transaction"
  );
  assert.equal(changed.ok, true);
  assert.equal(changed.coins, 95000);
  const duplicate = await command._test.changeWallet(
    Users, "wallet-user", -5000, "test-reserve-transaction"
  );
  assert.equal(duplicate.alreadyApplied, true);
  assert.equal(duplicate.coins, 95000);
});

test("TLMN wallets: pending transfer recovery credits the receiver once", async () => {
  const rows = new Map([
    ["sender", { tlmn: {
      coins: 90000, games: 0, wins: 0, losses: 0,
      transactions: ["pay-out:tx-pending"],
      pendingTransfers: [{ id: "tx-pending", target: "receiver", amount: 10000 }]
    }}],
    ["receiver", { tlmn: {
      coins: 100000, games: 0, wins: 0, losses: 0,
      transactions: [], pendingTransfers: []
    }}]
  ]);
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); },
    getAll() { return [...rows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const recovered = await command._test.reconcilePendingTransfers(Users);
  assert.deepEqual(recovered, ["tx-pending"]);
  assert.equal(rows.get("receiver").tlmn.coins, 110000);
  assert.equal(rows.get("sender").tlmn.pendingTransfers.length, 0);
  await command._test.reconcilePendingTransfers(Users);
  assert.equal(rows.get("receiver").tlmn.coins, 110000);
});


test("TLMN engine: cardCode returns parsable face/high-card codes", () => {
  for (const [rank, expected] of [[11, "jb"], [12, "qc"], [13, "kr"], [14, "ac"], [15, "2c"]]) {
    assert.equal(engine.cardCode({ rank, suit: expected.slice(-1) }), expected);
    assert.ok(engine.parseCardCode(engine.cardCode({ rank, suit: expected.slice(-1) })));
  }
});

test("TLMN engine: numbered hand selection maps left-to-right indexes to cards", () => {
  const hand = engine.sortHand(engine.createDeck());
  const selected = engine.parsePlayText(hand, "chon 1,2");
  assert.equal(selected.ok, true);
  assert.deepEqual(selected.cards.map(card => card.id), ["3b", "3ch"]);
  const selectedBySpaces = engine.parsePlayText(hand, "chon 1 2");
  assert.equal(selectedBySpaces.ok, true);
  assert.deepEqual(selectedBySpaces.cards.map(card => card.id), ["3b", "3ch"]);
  assert.equal(engine.parsePlayText(hand, "chon 0,99").code, "INVALID_SELECTION");
  assert.equal(engine.parsePlayText(hand, "chon 1,1").code, "INVALID_SELECTION");
});

test("TLMN command: invalid move replies are throttled per player and group", () => {
  const allow = command._test.shouldSendMoveError;
  assert.equal(allow("throttle-group", "p1", "INVALID_COMBINATION", 1000), true);
  assert.equal(allow("throttle-group", "p1", "INVALID_COMBINATION", 1001), false);
  assert.equal(allow("throttle-group", "p2", "INVALID_COMBINATION", 2000), false);
  assert.equal(allow("throttle-group", "p2", "UNRECOGNIZED_PLAY", 3600), true);
  assert.equal(allow("throttle-group", "p2", "UNRECOGNIZED_PLAY", 16000), false);
  assert.equal(allow("throttle-group", "p2", "UNRECOGNIZED_PLAY", 22000), true);
});

test("TLMN event plugin registers ordinary group messages", () => {
  const tlmnEvent = require("../plugins/events/tlmn");
  assert.ok(tlmnEvent.config.event_type.includes("message"));
  assert.equal(typeof tlmnEvent.run, "function");
});

test("TLMN service: a player who has passed and then leaves is removed from the pass set", () => {
  const groupId = "tlmn-pass-leave-cleanup";
  const created = game.create(groupId, { uid: "p1" });
  game.join(groupId, created.room.id, { uid: "p2" });
  game.join(groupId, created.room.id, { uid: "p3" });
  game.start(groupId, "p1", () => 0.37);
  const room = game.get(groupId);
  const leaver = "p2";
  room.passed.add(leaver);
  const result = game.leave(groupId, leaver);
  assert.equal(result.ok, true);
  assert.equal(room.passed.has(leaver), false);
  game.removeRoom(groupId);
});


test("TLMN service: corrupted saved room does not replace a valid live room", () => {
  const groupId = "tlmn-corrupt-recovery";
  const created = game.create(groupId, { uid: "safe-owner" });
  const liveRoom = game.get(groupId);
  const corrupt = {
    ...game.serialize(liveRoom),
    players: [
      { uid: "same", name: "A" },
      { uid: "same", name: "B" }
    ]
  };
  assert.equal(game.restore(corrupt), null);
  assert.equal(game.get(groupId), liveRoom);
  game.removeRoom(groupId);
});

test("TLMN wallet: reservation and refund are idempotent", async () => {
  const rows = new Map();
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); },
    getAll() { return [...rows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const room = game.create("tlmn-wallet-reserve", { uid: "cash-a" }).state;
  game.join("tlmn-wallet-reserve", room.id, { uid: "cash-b" });
  const reserved = await command._test.reserveRoomWallets(Users, room, async () => true);
  assert.equal(reserved.ok, true);
  assert.equal((await command._test.readWallet(Users, "cash-a")).coins, 95000);
  assert.equal((await command._test.readWallet(Users, "cash-b")).coins, 95000);
  assert.equal(await command._test.refundRoomWallets(Users, room, async () => true), true);
  assert.equal((await command._test.readWallet(Users, "cash-a")).coins, 100000);
  assert.equal((await command._test.readWallet(Users, "cash-b")).coins, 100000);
  assert.equal(await command._test.refundRoomWallets(Users, room, async () => true), true);
  game.removeRoom("tlmn-wallet-reserve");
});

test("TLMN wallet: lost write acknowledgement can be reconciled and refunded", async () => {
  const rows = new Map();
  let failNextAck = false;
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) {
      rows.set(String(uid), data);
      if (failNextAck) {
        failNextAck = false;
        throw new Error("simulated acknowledgement loss");
      }
    },
    getAll() { return [...rows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const room = game.create("tlmn-wallet-uncertain", { uid: "uncertain-a" }).state;
  game.join("tlmn-wallet-uncertain", room.id, { uid: "uncertain-b" });
  await command._test.readWallet(Users, "uncertain-a");
  await command._test.readWallet(Users, "uncertain-b");
  failNextAck = true;
  const reserved = await command._test.reserveRoomWallets(Users, room, async () => true);
  assert.equal(reserved.ok, false);
  assert.ok(Object.keys(room.lockPending).length > 0);
  assert.equal(await command._test.reconcilePendingReservations(Users, room, async () => true), true);
  assert.ok(room.locked["uncertain-a"] > 0);
  assert.equal(await command._test.refundRoomWallets(Users, room, async () => true), true);
  assert.equal((await command._test.readWallet(Users, "uncertain-a")).coins, 100000);
  game.removeRoom("tlmn-wallet-uncertain");
});

test("TLMN wallet: pending transfer recovery cannot credit the receiver twice", async () => {
  const rows = new Map([
    ["sender", { tlmn: {
      coins: 90000, games: 0, wins: 0, losses: 0,
      transactions: ["pay-out:tx-once"],
      pendingTransfers: [{ id: "tx-once", target: "receiver", amount: 10000 }]
    }}],
    ["receiver", { tlmn: {
      coins: 100000, games: 0, wins: 0, losses: 0,
      transactions: [], pendingTransfers: []
    }}]
  ]);
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); },
    getAll() { return [...rows.entries()].map(([userId, data]) => ({ userId, data })); }
  };
  const recovered = await command._test.reconcilePendingTransfers(Users);
  assert.deepEqual(recovered, ["tx-once"]);
  await command._test.reconcilePendingTransfers(Users);
  assert.equal(rows.get("receiver").tlmn.coins, 110000);
  assert.equal(rows.get("sender").tlmn.pendingTransfers.length, 0);
});

test("TLMN wallet: settlement is idempotent and statistics are atomic with payout", async () => {
  const rows = new Map();
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); }
  };
  await command._test.readWallet(Users, "winner");
  await command._test.readWallet(Users, "loser");
  const room = game.create("tlmn-settlement", { uid: "winner" }).state;
  game.join("tlmn-settlement", room.id, { uid: "loser" });
  room.locked = { winner: 5000, loser: 5000 };
  const results = [
    { uid: "winner", name: "Winner", place: 1 },
    { uid: "loser", name: "Loser", place: 2 }
  ];
  const first = await command._test.settleRoomWallets(Users, room, results);
  const afterFirst = await command._test.readWallet(Users, "winner");
  const second = await command._test.settleRoomWallets(Users, room, results);
  const afterSecond = await command._test.readWallet(Users, "winner");
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(afterFirst.coins, afterSecond.coins);
  assert.equal(afterSecond.games, 1);
  assert.equal(afterSecond.wins, 1);
  game.removeRoom("tlmn-settlement");
});


test("TLMN deal: 3♠ is always in a dealt hand for 2, 3, and 4 players", () => {
  let checked = 0;
  for (const playerCount of [2, 3, 4]) {
    for (let seed = 1; seed <= 200; seed += 1) {
      let state = (seed * 0.6180339887) % 1;
      const random = () => {
        state = (state * 9301 + 49297) % 233280;
        return state / 233280;
      };
      const ids = Array.from({ length: playerCount }, (_, index) => "seed-" + index);
      const dealt = engine.dealCards(ids, random);
      assert.ok(dealt.firstPlayerId, "missing first player: " + playerCount + " players, seed " + seed);
      assert.ok(dealt.hands[dealt.firstPlayerId].some(card => card.id === "3b"));
      assert.ok(ids.every(uid => dealt.hands[uid].length === 13));
      checked += 1;
    }
  }
  assert.equal(checked, 600);
});

test("TLMN service: leaving a player who already passed completes the pass cycle", () => {
  const groupId = "tlmn-leave-completes-pass";
  const room = game.create(groupId, { uid: "leader" }).state;
  game.join(groupId, room.id, { uid: "passed-player" });
  game.join(groupId, room.id, { uid: "leaving-player" });
  game.start(groupId, "leader", () => 0.2);

  room.lastPlayerUid = "leader";
  room.turnUid = "leaving-player";
  room.currentCombo = { type: "single", length: 1, mainRank: 3, cards: [{ rank: 3, suit: "b", id: "3b" }] };
  room.lastPlay = { uid: "leader", name: "Leader", cards: [{ rank: 3, suit: "b", id: "3b" }] };
  room.passed.add("passed-player");

  const result = game.leave(groupId, "leaving-player");
  assert.equal(result.ok, true);
  assert.equal(room.currentCombo, null);
  assert.equal(room.lastPlay, null);
  assert.equal(room.turnUid, "leader");
  assert.equal(room.passed.size, 0);
  game.removeRoom(groupId);
});

test("TLMN service: each created room has a unique settlement token", () => {
  const first = game.create("tlmn-token-one", { uid: "a" }).state;
  const second = game.create("tlmn-token-two", { uid: "b" }).state;
  assert.ok(first.gameToken);
  assert.ok(second.gameToken);
  assert.notEqual(first.gameToken, second.gameToken);
  game.removeRoom("tlmn-token-one");
  game.removeRoom("tlmn-token-two");
});

test("TLMN service: malformed saved state cannot replace a valid active room", () => {
  const groupId = "tlmn-invalid-restore-guard";
  game.create(groupId, { uid: "owner" });
  const current = game.get(groupId);
  const corrupted = {
    ...game.serialize(current),
    players: [{ uid: "duplicate" }, { uid: "duplicate" }]
  };
  assert.equal(game.restore(corrupted), null);
  assert.equal(game.get(groupId), current);
  game.removeRoom(groupId);
});


test("TLMN command: concurrent group operations are serialized", async () => {
  const order = [];
  const lock = command._test.withRoomActionLock;
  const first = lock("tlmn-concurrency", async () => {
    order.push("first:start");
    await Promise.resolve();
    order.push("first:end");
  });
  const second = lock("tlmn-concurrency", async () => {
    order.push("second:start");
    await Promise.resolve();
    order.push("second:end");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first:start", "first:end", "second:start", "second:end"
  ]);
});


test("TLMN wallet: corrupt balances are rejected, never reset to the default amount", async () => {
  const rows = new Map([["broken", { tlmn: { coins: -500 } }]]);
  let writes = 0;
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { writes += 1; rows.set(String(uid), data); }
  };
  await assert.rejects(
    command._test.readWallet(Users, "broken"),
    /số dư lỗi/
  );
  assert.equal(writes, 0);
  assert.equal(rows.get("broken").tlmn.coins, -500);
});

test("TLMN settlement: missing buy-in is rejected without minting coins", async () => {
  const rows = new Map();
  const Users = {
    async getData(uid) { return { data: rows.get(String(uid)) || {} }; },
    async setDataAndWait(uid, data) { rows.set(String(uid), data); }
  };
  const room = game.create("tlmn-no-buyin", { uid: "no-buyin-a" }).state;
  game.join("tlmn-no-buyin", room.id, { uid: "no-buyin-b" });
  room.locked = { "no-buyin-a": 5000 };
  await command._test.readWallet(Users, "no-buyin-a");
  await command._test.readWallet(Users, "no-buyin-b");
  await assert.rejects(
    command._test.settleRoomWallets(Users, room, [
      { uid: "no-buyin-a", name: "A", place: 1 },
      { uid: "no-buyin-b", name: "B", place: 2 }
    ]),
    /Thiếu khoản giữ cược/
  );
  assert.equal((await command._test.readWallet(Users, "no-buyin-a")).coins, 100000);
  assert.equal((await command._test.readWallet(Users, "no-buyin-b")).coins, 100000);
  game.removeRoom("tlmn-no-buyin");
});


test("TLMN private card: leaving a round recalls the departing player's hand", async () => {
  const room = game.create("tlmn-private-revoke", { uid: "owner" }).state;
  game.join("tlmn-private-revoke", room.id, { uid: "guest" });
  room.messageCards.private.guest = [{ msgId: "hand-msg", cliMsgId: "hand-cli" }];
  const recalled = [];
  const api = {
    async undo(target, threadId, type) {
      recalled.push({ target, threadId, type });
      return true;
    }
  };
  assert.equal(await command._test.recallPrivateHand(api, room, "guest"), true);
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].target.msgId, "hand-msg");
  assert.equal(room.messageCards.private.guest, undefined);
  game.removeRoom("tlmn-private-revoke");
});

test("TLMN renderer: table layout provides seats around the center for 2, 3, and 4 players", () => {
  const renderer = require("../core/canvas/tlmn");
  for (const count of [2, 3, 4]) {
    const players = Array.from({ length: count }, (_, index) => ({
      uid: "seat-" + index,
      name: "Player " + index,
      handCount: 13
    }));
    const layout = renderer._test.seatLayout(count);
    assert.equal(layout.length, count);
    assert.equal(new Set(layout.map(seat => seat.x + ":" + seat.y)).size, count);
    assert.ok(layout.every(seat => seat.w > 0 && seat.h > 0));
  }
});


test("TLMN turn UX: pass refreshes the passer's private hand without a second DM", async () => {
  const groupId = "tlmn-pass-hand-refresh";
  const sent = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      const msgId = "pass-" + (sent.length + 1);
      sent.push({ payload, threadId: String(threadId), type, msgId });
      return { message: { msgId, cliMsgId: "cli-" + msgId } };
    },
    async undo() { return true; }
  };
  const threadRows = new Map([[groupId, { bot_enabled: true }]]);
  const Threads = {
    async getData(id) { return { data: { ...(threadRows.get(String(id)) || {}) } }; },
    async setDataAndWait(id, data) { threadRows.set(String(id), { ...data }); },
    async setData(id, data) { threadRows.set(String(id), { ...data }); },
    getCachedData(id) { return { data: { ...(threadRows.get(String(id)) || {}) } }; }
  };
  const Users = {
    async getData() { return { data: {} }; },
    async setDataAndWait() {}
  };
  const created = game.create(groupId, { uid: "pass-owner", name: "Owner" });
  game.join(groupId, created.room.id, { uid: "pass-a", name: "Player A" });
  game.join(groupId, created.room.id, { uid: "pass-b", name: "Player B" });
  game.start(groupId, "pass-owner", () => 0.37);
  const room = game.get(groupId);
  const opener = room.turnUid;
  assert.equal(game.play(groupId, opener, "3b").ok, true);
  const passerUid = room.turnUid;
  const passer = room.players.find(item => item.uid === passerUid);
  const event = {
    threadId: groupId,
    type: ThreadType.Group,
    data: { uidFrom: passerUid, dName: passer.name, content: "pass" }
  };
  try {
    await command.handleIncoming({ api, event, Users, Threads });
    const privateUpdates = sent.filter(item =>
      item.type === ThreadType.User && item.threadId === passerUid &&
      String(item.payload.msg || "").includes("BÀI TRÊN TAY CỦA BẠN")
    );
    assert.equal(privateUpdates.length, 1);
    assert.match(String(privateUpdates[0].payload.msg), /Chỉ bạn nhìn thấy/);
    assert.doesNotMatch(String(privateUpdates[0].payload.msg), /ĐẾN LƯỢT BẠN/);
    assert.equal(sent.filter(item => item.type === ThreadType.User && item.threadId === passerUid).length, 1);
  } finally {
    game.removeRoom(groupId);
  }
});

test("TLMN leave UX: a departing player has their private hand recalled", async () => {
  const groupId = "tlmn-leave-recall";
  const recalled = [];
  const api = {
    async sendMessage(payload, threadId, type) {
      return { message: { msgId: "leave-" + String(threadId), cliMsgId: "cli-" + String(threadId) } };
    },
    async undo(target, threadId, type) {
      recalled.push({ target, threadId: String(threadId), type });
      return true;
    }
  };
  const threadRows = new Map([[groupId, { bot_enabled: true }]]);
  const Threads = {
    async getData(id) { return { data: { ...(threadRows.get(String(id)) || {}) } }; },
    async setDataAndWait(id, data) { threadRows.set(String(id), { ...data }); },
    async setData(id, data) { threadRows.set(String(id), { ...data }); },
    getCachedData(id) { return { data: { ...(threadRows.get(String(id)) || {}) } }; }
  };
  const Users = {
    async getData() { return { data: {} }; },
    async setDataAndWait() {}
  };
  const created = game.create(groupId, { uid: "leave-owner", name: "Owner" });
  game.join(groupId, created.room.id, { uid: "leave-a", name: "Player A" });
  game.join(groupId, created.room.id, { uid: "leave-b", name: "Player B" });
  game.start(groupId, "leave-owner", () => 0.37);
  const room = game.get(groupId);
  room.messageCards.private["leave-a"] = [
    { msgId: "old-private-card", cliMsgId: "old-private-cli" }
  ];
  try {
    await command.handleIncoming({
      api, Users, Threads,
      event: {
        threadId: groupId,
        type: ThreadType.Group,
        data: { uidFrom: "leave-a", dName: "Player A", content: "leave" }
      }
    });
    assert.ok(recalled.some(item => item.target.msgId === "old-private-card"));
    assert.equal(room.messageCards.private["leave-a"], undefined);
    assert.equal(room.activeUids.includes("leave-a"), false);
  } finally {
    game.removeRoom(groupId);
  }
});
