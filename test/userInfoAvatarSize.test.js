"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

test("wrapped getUserInfo preserves requested avatar size and caches per size", async () => {
  const calls = [];
  const api = {
    sendMessage: async () => ({}),
    getUserInfo: async (uid, size) => {
      calls.push([uid, size]);
      return { size };
    }
  };
  const wrapped = wrapApi(api, "avatar-size-thread", 0, "test");
  const first = await wrapped.getUserInfo("avatar-size-user", 240);
  const second = await wrapped.getUserInfo("avatar-size-user", 240);
  assert.equal(first.size, 240);
  assert.equal(second.size, 240);
  assert.equal(calls.length, 1);
  await wrapped.invalidateCache("user", "avatar-size-user");
  await wrapped.getUserInfo("avatar-size-user", 240);
  assert.equal(calls.length, 2);
});
