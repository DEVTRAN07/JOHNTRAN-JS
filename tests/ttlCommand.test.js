"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/ttl");

test("ttl parser accepts custom whole-day values from 1 to 30", () => {
  for (const days of [1, 2, 5, 7, 14, 21, 30]) {
    const result = command._test.parseTTL(days + "d");
    assert.equal(result.ok, true);
    assert.equal(result.days, days);
    assert.equal(result.ttl, days * command._test.DAY_MS);
  }
});

test("ttl parser accepts off aliases", () => {
  for (const value of ["off", "tat", "tắt", "0"]) {
    assert.deepEqual(command._test.parseTTL(value), { ok: true, ttl: 0, days: 0 });
  }
});

test("ttl parser rejects values outside Zalo's documented range and sub-day values", () => {
  for (const value of ["0d", "31d", "45d", "30m", "2h", "abc", "-1d"]) {
    assert.equal(command._test.parseTTL(value).ok, false, value);
  }
});

test("findConversation matches both conversation ID and group type", () => {
  const response = { convers: [
    { destId: "100", isGroup: 0, ttl: 86400000 },
    { destId: "100", isGroup: 1, ttl: 604800000 }
  ] };
  assert.equal(command._test.findConversation(response, "100", false).ttl, 86400000);
  assert.equal(command._test.findConversation(response, "100", true).ttl, 604800000);
  assert.equal(command._test.findConversation(response, "200", true), null);
});

test("ttl command verifies API state before reporting success", async () => {
  const messages = [];
  const event = { threadId: "group-1", type: 1 };
  const api = {
    async updateAutoDeleteChat(ttl, threadId, type) {
      assert.equal(ttl, 5 * command._test.DAY_MS);
      assert.equal(threadId, "group-1");
      return "ok";
    },
    async getAutoDeleteChat() {
      return { convers: [{ destId: "group-1", isGroup: 1, ttl: 5 * command._test.DAY_MS }] };
    },
    async sendMessage(payload) { messages.push(payload.msg); }
  };

  await command.run({ args: ["5d"], event, api });
  assert.match(messages[0], /Đã xác minh Zalo đã đặt 5 ngày/);
});

test("ttl command never claims success when read-back does not match", async () => {
  const messages = [];
  const event = { threadId: "group-1", type: 1 };
  const api = {
    async updateAutoDeleteChat() { return "ok"; },
    async getAutoDeleteChat() { return { convers: [] }; },
    async sendMessage(payload) { messages.push(payload.msg); }
  };

  await command.run({ args: ["5d"], event, api });
  assert.match(messages[0], /chưa xác minh được/);
  assert.doesNotMatch(messages[0], /Đã xác minh Zalo/);
});
