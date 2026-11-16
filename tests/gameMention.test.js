"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRequesterMention, withRequesterMention } = require("../core/mentions");

test("game command replies include a real Zalo mention for the command sender", () => {
  global.config = { prefix: "!" };
  const event = {
    type: 1,
    data: { uidFrom: "user-123", dName: "Trần Quang", content: "!caro solo" }
  };

  const result = withRequesterMention(event, { msg: "Bắt đầu game." });
  assert.equal(result.msg, "@Trần Quang\nBắt đầu game.");
  assert.deepEqual(result.mentions, [{ pos: 0, uid: "user-123", len: "@Trần Quang".length }]);
});

test("canvas card payload keeps attachments and recall settings when tagging requester", () => {
  global.config = { prefix: "/" };
  const attachment = "/tmp/caro-board.png";
  const result = withRequesterMention({
    type: 1,
    data: { uidFrom: "user-456", dName: "MrQ", content: "/caro pvp" }
  }, { msg: "Bàn cờ", attachments: [attachment], recallAfterMs: 0 });

  assert.equal(result.msg, "@MrQ\nBàn cờ");
  assert.deepEqual(result.mentions, [{ pos: 0, uid: "user-456", len: 4 }]);
  assert.deepEqual(result.attachments, [attachment]);
  assert.equal(result.recallAfterMs, 0);
});

test("plain game answers are not tagged as command invocations", () => {
  const event = {
    type: 1,
    data: { uidFrom: "player-1", dName: "Player", content: "sinh viên" }
  };
  assert.equal(buildRequesterMention(event), null);
  const payload = { msg: "Đã nhận nước đi." };
  assert.equal(withRequesterMention(event, payload), payload);
});

test("plain-text game actions such as join caro, stop, and pass tag their sender", () => {
  for (const content of ["join caro", "stop", "pass"]) {
    const mention = buildRequesterMention({
      type: 1,
      data: { uidFrom: "u-1", dName: "Game Player", content }
    });
    assert.equal(mention.mention.uid, "u-1");
    assert.equal(mention.mention.pos, 0);
    assert.equal(mention.text, "@Game Player\n");
  }
});

test("mentions are group-only and do not add a visible fake tag in private chats", () => {
  const event = {
    type: 0,
    data: { uidFrom: "u-1", dName: "Player", content: "!caro solo" }
  };
  const payload = { msg: "Bắt đầu game." };
  assert.equal(withRequesterMention(event, payload), payload);
});
