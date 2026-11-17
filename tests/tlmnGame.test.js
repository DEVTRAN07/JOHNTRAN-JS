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
