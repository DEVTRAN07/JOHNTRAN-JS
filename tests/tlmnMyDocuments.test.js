"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const rendererPath = require.resolve("../core/canvas/workerRender");
const canvasCalls = [];
require.cache[rendererPath] = {
  id: rendererPath,
  filename: rendererPath,
  loaded: true,
  exports: {
    renderCanvas: async (...args) => {
      canvasCalls.push(args);
      return "/tmp/tlmn-mydoc-test.png";
    }
  }
};

const command = require("../plugins/commands/tlmn");

function makeApi() {
  const sent = [];
  let nextId = 0;
  return {
    sent,
    getOwnId() { return "bot-account-uid"; },
    getContext() {
      return { loginInfo: { send2me_id: "my-documents-thread-id" } };
    },
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId: String(threadId), type });
      const id = "mydoc-" + (++nextId);
      return { message: { msgId: id, cliMsgId: id + "-client" }, attachment: [] };
    },
    async undo() { return true; }
  };
}

const room = {
  id: "74123",
  threadId: "tlmn-mydoc-test-group",
  bet: 5000,
  mode: "nhatnhi",
  practice: true
};
const hand = [
  { rank: 3, suit: "b", id: "3b" },
  { rank: 4, suit: "r", id: "4r" },
  { rank: 5, suit: "c", id: "5c" }
];

test("TLMN resolves the bot's own UID to the My Documents thread", () => {
  const api = makeApi();
  assert.deepEqual(command._test.privateDestination(api, "bot-account-uid"), {
    threadId: "my-documents-thread-id",
    type: 0,
    myDocuments: true
  });
});

test("TLMN keeps other players on their normal private UID thread", () => {
  const api = makeApi();
  assert.deepEqual(command._test.privateDestination(api, "other-player-uid"), {
    threadId: "other-player-uid",
    type: 0,
    myDocuments: false
  });
});

test("TLMN sends the bot owner's admin hand card to My Documents", async () => {
  global.users = { admin: ["bot-account-uid"] };
  const api = makeApi();
  const player = { uid: "bot-account-uid", name: "Admin" };
  const delivered = await command._test.sendPrivateHand(api, room, player, hand, true);
  assert.equal(delivered, true);
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].threadId, "my-documents-thread-id");
  assert.match(api.sent[0].payload.msg, /My Documents/);
  assert.match(api.sent[0].payload.msg, /BÀI HOÀNG GIA CỦA ADMIN/);
  assert.equal(api.sent[0].payload.attachments[0], "/tmp/tlmn-mydoc-test.png");
});

test("TLMN Admin keeps the royal hand design in real-player rooms too", async () => {
  const previousUsers = global.users;
  global.users = { admin: ["bot-account-uid"] };
  canvasCalls.length = 0;
  try {
    const api = makeApi();
    const realPlayerRoom = { ...room, practice: false };
    const delivered = await command._test.sendPrivateHand(
      api, realPlayerRoom, { uid: "bot-account-uid", name: "Admin" }, hand, false
    );
    assert.equal(delivered, true);
    assert.equal(canvasCalls.length, 1);
    assert.equal(canvasCalls[0][0], "tlmn");
    assert.equal(canvasCalls[0][1].isAdmin, true);
    assert.equal(canvasCalls[0][1].room.practice, false);
    assert.match(api.sent[0].payload.msg, /BÀI HOÀNG GIA CỦA ADMIN/);
  } finally {
    global.users = previousUsers;
  }
});

test("TLMN sends another player's private hand to that player's own chat", async () => {
  const api = makeApi();
  const player = { uid: "other-player-uid", name: "Người chơi" };
  const delivered = await command._test.sendPrivateHand(api, room, player, hand, false);
  assert.equal(delivered, true);
  assert.equal(api.sent.length, 1);
  assert.equal(api.sent[0].threadId, "other-player-uid");
  assert.doesNotMatch(api.sent[0].payload.msg, /Đã lưu vào My Documents/);
});
