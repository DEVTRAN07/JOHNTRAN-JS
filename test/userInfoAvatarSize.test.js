"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapApi } = require("../core/message");

test("getUserInfo forwards avatar size and maintains a separate cache per size", async () => {
  const calls = [];
  const api = {
    async getUserInfo(uid, avatarSize) {
      calls.push({ uid, avatarSize });
      return { changed_profiles: { [uid]: { displayName: "User", avatar: "https://zalo.example/a.png" } } };
    }
  };
  const wrapped = wrapApi(api, "thread", 1, "avatar-size-test");
  const uid = "avatar-size-test-" + Date.now();

  const largeFirst = await wrapped.getUserInfo(uid, 240);
  const largeCached = await wrapped.getUserInfo(uid, 240);
  assert.deepEqual(calls, [{ uid, avatarSize: 240 }]);
  assert.equal(largeFirst, largeCached);

  await wrapped.getUserInfo(uid);
  assert.equal(calls.length, 2, "default-size and large-size profiles use separate cache entries");
  assert.equal(calls[1].avatarSize, undefined);

  await wrapped.invalidateCache("user", uid);
  await wrapped.getUserInfo(uid, 240);
  assert.equal(calls.length, 3, "user invalidation clears every cached avatar size");
});
