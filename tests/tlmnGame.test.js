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

test("Tiến Lên: hướng dẫn được gửi riêng một lần, bài riêng không lặp lại phần lệnh dài", async () => {
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

    const countdownRoom = game.get(group.threadId);
    assert.ok(countdownRoom?.startCountdownAt > Date.now(), "start opens a ten-second countdown before dealing");
    command._test.clearStartCountdownTimer(group.threadId);
    countdownRoom.startCountdownAt = null;
    countdownRoom.startCountdownBy = null;
    countdownRoom.startCountdownMessage = null;
    await command._test.completeStartCountdown(api, group, Users, Threads, countdownRoom);

    const privateGuides = sent.filter(row =>
      row.type === ThreadType.User && !Array.isArray(row.payload.attachments) &&
      String(row.payload.msg || "").includes("HƯỚNG DẪN TIẾN LÊN MIỀN NAM")
    );
    assert.equal(privateGuides.length, 2, "each real player gets a separate first-time guide");
    assert.ok(privateGuides.every(row => row.threadId !== group.threadId));
    assert.ok(privateGuides.every(row => String(row.payload.msg).includes("tất cả nhà còn lại đều thua")));
    const privateImages = sent.filter(row => row.type === ThreadType.User && Array.isArray(row.payload.attachments));
    assert.equal(privateImages.length, 2, "one private hand image per player");
    assert.ok(privateImages.every(row => row.threadId !== group.threadId));
    assert.ok(privateImages.every(row => String(row.payload.msg).includes("BÀI TRÊN TAY CỦA BẠN")));
    assert.ok(privateImages.every(row => !String(row.payload.msg).includes("LỆNH ĐÁNH NHANH GỢI Ý")));
    const groupPayloads = sent.filter(row => row.threadId === group.threadId);
    assert.equal(groupPayloads.some(row => String(row.payload.msg || "").includes("BÀI TRÊN TAY CỦA BẠN")), false);
    assert.equal(groupPayloads.some(row => String(row.payload.msg || "").includes("KHÔNG CHẶN TIN NHẮN NGƯỜI LẠ")), false);

    await command._test.sendPrivateGameGuide(api, Users, "owner");
    await command._test.sendPrivateGameGuide(api, Users, "guest");
    assert.equal(sent.filter(row =>
      row.type === ThreadType.User && !Array.isArray(row.payload.attachments) &&
      String(row.payload.msg || "").includes("HƯỚNG DẪN TIẾN LÊN MIỀN NAM")
    ).length, 2, "later turns do not resend the guide");
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
    assert.ok(ids.includes(dealt.firstPlayerId));
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

test("TLMN service: timeout automatically plays a legal card on the random opening turn", () => {
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
  assert.equal(timeout.combo.cards.length, 1);
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

test("TLMN board tags the human whose turn is active", () => {
  const room = {
    status: "playing",
    turnUid: "next-player",
    players: [
      { uid: "owner", name: "Owner" },
      { uid: "next-player", name: "Nguyễn Văn A" }
    ]
  };
  const tagged = command._test.buildTurnMentionCaption(room, "TABLE");
  assert.match(tagged.caption, /@Nguyễn Văn A/);
  assert.equal(tagged.mentions.length, 1);
  assert.equal(tagged.mentions[0].uid, "next-player");
  assert.equal(tagged.caption.slice(tagged.mentions[0].pos,
    tagged.mentions[0].pos + tagged.mentions[0].len), "@Nguyễn Văn A");

  const aiRoom = {
    ...room,
    players: [...room.players, { uid: "tlmn-ai:1", name: "AI", ai: true }],
    turnUid: "tlmn-ai:1"
  };
  assert.deepEqual(command._test.buildTurnMentionCaption(aiRoom, "TABLE"), {
    caption: "TABLE",
    mentions: []
  });
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
  room.bet = 5000;
  room.locked = { winner: 500000, loser: 500000 };
  room.hands = { winner: [], loser: [{ rank: 3, suit: "b", id: "3b" }] };
  room.settlement = {
    bet: 5000, winnerUid: "winner",
    transfers: [{ from: "loser", to: "winner", amount: 5000, reason: "thoi-bai" }],
    net: { winner: 5000, loser: -5000 }
  };
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


test("TLMN deal: random first player is valid for 2, 3, and 4 players", () => {
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
      assert.ok(ids.includes(dealt.firstPlayerId));
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
    /Thiếu khoản ký quỹ/
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
  const openerCard = engine.sortHand(room.hands[opener])[0];
  assert.equal(game.play(groupId, opener, engine.cardCode(openerCard)).ok, true);
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


test("TLMN new rule table calculates rác, black/red heo, đôi thông and tứ quý", () => {
  const bet = 1000;
  assert.equal(game.calculateLeftoverPenalty([
    { rank: 3, suit: "b", id: "3b" }, { rank: 15, suit: "b", id: "15b" }
  ], bet), 3000);
  assert.equal(game.calculateLeftoverPenalty([
    { rank: 3, suit: "b", id: "3b" }, { rank: 15, suit: "c", id: "15c" }
  ], bet), 5000);
  assert.equal(game.calculateLeftoverPenalty([
    { rank: 15, suit: "b", id: "15b" }, { rank: 15, suit: "ch", id: "15ch" }
  ], bet), 4000);
  assert.equal(game.calculateLeftoverPenalty([3,4,5].flatMap(rank => [
    { rank, suit: "b", id: String(rank) + "b" },
    { rank, suit: "c", id: String(rank) + "c" }
  ]), bet), 6000);
  assert.equal(game.calculateLeftoverPenalty([7,7,7,7].map((rank, index) => ({
    rank, suit: ["b","ch","r","c"][index], id: String(rank) + ["b","ch","r","c"][index]
  })), bet), 8000);
  assert.equal(game.calculateLeftoverPenalty([15,15,15,15].map((rank, index) => ({
    rank, suit: ["b","ch","r","c"][index], id: String(rank) + ["b","ch","r","c"][index]
  })), bet), 12000, "two black and two red twos are charged by their two-pair rates only");
  assert.equal(game.calculateLeftoverPenalty([3,4,5,6].flatMap(rank => [
    { rank, suit: "b", id: String(rank) + "b" },
    { rank, suit: "c", id: String(rank) + "c" }
  ]), bet), 12000);
});

test("TLMN settlement ledger is zero-sum and applies chop transfers separately", () => {
  const room = {
    bet: 1000,
    players: [{ uid: "a" }, { uid: "b" }, { uid: "c" }],
    finishOrder: ["a"],
    hands: {
      a: [],
      b: [{ rank: 3, suit: "b", id: "3b" }],
      c: [{ rank: 4, suit: "b", id: "4b" }]
    },
    chopEvents: [{ from: "b", to: "c", amount: 6000, reason: "chop-three-pairs" }]
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(Object.values(settlement.net).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(settlement.net.a, 2000);
  assert.equal(settlement.net.b, -7000);
  assert.equal(settlement.net.c, 5000);
});

test("TLMN white-hand multiplier follows the supplied priority schedule", () => {
  const room = {
    bet: 1000,
    players: [{ uid: "winner" }, { uid: "loser" }],
    hands: { winner: [], loser: [] },
    whiteHand: { uid: "winner", type: "fivePairRun" }
  };
  const settlement = game.calculateSettlement(room);
  assert.equal(settlement.net.winner, 4000);
  assert.equal(settlement.net.loser, -4000);
});


test("TLMN blocked kết 3 bích charges every player who joined the final trick", () => {
  const groupId = "tlmn-block-three-spades-ledger";
  const created = game.create(groupId, { uid: "a", name: "A" });
  game.join(groupId, created.room.id, { uid: "b", name: "B" });
  game.join(groupId, created.room.id, { uid: "c", name: "C" });
  const started = game.start(groupId, "a", () => 0.31);
  assert.equal(started.ok, true);
  const room = started.state;
  room.status = "playing";
  room.hands = {
    a: [{ rank: 3, suit: "b", id: "3b" }],
    b: [{ rank: 4, suit: "b", id: "4b" }, { rank: 7, suit: "b", id: "7b" }],
    c: [{ rank: 6, suit: "b", id: "6b" }]
  };
  room.activeUids = ["a", "b", "c"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.turnUid = "a";
  room.currentCombo = null;
  room.lastPlayerUid = null;
  room.lastPlay = null;
  room.playedCount = 0;
  room.trickParticipants = [];
  assert.equal(game.play(groupId, "a", "3b").ok, true);
  const blocked = game.play(groupId, "b", "4b");
  assert.equal(blocked.ok, true);
  assert.equal(room.threeSpadesBlockedByUid, "b");
  assert.ok(room.forfeitUids.includes("a"));
  assert.equal(game.pass(groupId, "c").roundCleared, true);
  assert.deepEqual(room.threeSpadesBlockEvents.map(item => item.to).sort(), ["b", "c"]);
  assert.ok(room.threeSpadesBlockEvents.every(item => item.from === "a" && item.amount === 26 * room.bet));
  game.removeRoom(groupId);
});

test("TLMN chặt 2 đen pays 3 stakes and 2 đỏ pays 6 stakes", () => {
  const groupId = "tlmn-heo-chop-rates";
  const created = game.create(groupId, { uid: "chopper", name: "Chopper" });
  game.join(groupId, created.room.id, { uid: "victim", name: "Victim" });
  const started = game.start(groupId, "chopper", () => 0.33);
  assert.equal(started.ok, true);
  const room = started.state;
  room.status = "playing";
  room.hands = {
    chopper: [3,4,5].flatMap(rank => [
      { rank, suit: "b", id: String(rank) + "b" },
      { rank, suit: "c", id: String(rank) + "c" }
    ]).concat([{ rank: 9, suit: "b", id: "9b" }]),
    victim: [{ rank: 15, suit: "b", id: "15b" }]
  };
  room.activeUids = ["chopper", "victim"];
  room.turnUid = "chopper";
  room.currentCombo = engine.analyzeCombo([{ rank: 15, suit: "b", id: "15b" }]);
  room.lastPlayerUid = "victim";
  room.playedCount = 1;
  const result = game.play(groupId, "chopper", "3dt");
  assert.equal(result.ok, true);
  assert.equal(room.chopEvents[0].amount, 3 * room.bet);
  game.removeRoom(groupId);
});


test("TLMN GameVH: four-pair run can cut after a prior pass and settles the full chop chain", () => {
  const groupId = "tlmn-gamevh-chop-chain-after-pass";
  const room = game.create(groupId, { uid: "p1", name: "P1" }).state;
  game.join(groupId, room.id, { uid: "p2", name: "P2" });
  game.join(groupId, room.id, { uid: "p3", name: "P3" });
  game.join(groupId, room.id, { uid: "p4", name: "P4" });
  game.start(groupId, "p1", () => 0.37);
  room.status = "playing";
  room.activeUids = ["p1", "p2", "p3", "p4"];
  room.finishOrder = [];
  room.forfeitUids = [];
  room.passed = new Set();
  room.chopEvents = [];
  room.chopChainUnits = 0;
  room.chopChainEventIndex = null;
  room.trickTwoUnits = 0;
  room.hands = {
    p1: [{ rank: 15, suit: "b", id: "15b" }, { rank: 12, suit: "b", id: "12b" }],
    p2: [4,5,6,7].flatMap(rank => [
      { rank, suit: "b", id: String(rank) + "b" },
      { rank, suit: "c", id: String(rank) + "c" }
    ]).concat([{ rank: 13, suit: "c", id: "13c" }]),
    p3: [{ rank: 15, suit: "ch", id: "15ch" }, { rank: 11, suit: "b", id: "11b" }],
    p4: [8,9,10].flatMap(rank => [
      { rank, suit: "b", id: String(rank) + "b" },
      { rank, suit: "c", id: String(rank) + "c" }
    ]).concat([{ rank: 12, suit: "c", id: "12c" }])
  };
  room.turnUid = "p1";
  assert.equal(game.play(groupId, "p1", "2b").ok, true);
  assert.equal(game.pass(groupId, "p2").ok, true);
  assert.equal(room.turnUid, "p3");
  assert.equal(game.play(groupId, "p3", "2ch").ok, true);
  assert.equal(game.play(groupId, "p4", "3dt").ok, true);
  assert.equal(room.turnUid, "p1");
  assert.equal(game.pass(groupId, "p1").ok, true);
  assert.equal(room.turnUid, "p2");
  assert.equal(room.passed.has("p2"), true, "the earlier pass remains active");
  assert.equal(game.play(groupId, "p2", "kc").code, "ALREADY_PASSED");

  const finalCut = game.play(groupId, "p2", "4dt");
  assert.equal(finalCut.ok, true, "the player who passed earlier can use four pair runs to cut");
  assert.equal(room.chopEvents.length, 1, "a chop chain must settle only once");
  assert.deepEqual(room.chopEvents[0], {
    from: "p4", to: "p2", amount: 15 * room.bet, reason: "chop-chain"
  });
  game.removeRoom(groupId);
});
