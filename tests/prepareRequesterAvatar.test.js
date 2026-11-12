"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const avatarCache = require("../core/canvas/avatarCache");
const { prepareRequesterAvatar, AVATAR_PRELOAD_TIMEOUT_MS } = require("../core/canvas/prepareRequesterAvatar");

test("menu worker preloads the caller avatar in its own cache", async () => {
  const original = avatarCache.warmAvatar;
  const calls = [];
  avatarCache.warmAvatar = async (...args) => {
    calls.push(args);
    return { width: 12, height: 12 };
  };
  try {
    assert.equal(await prepareRequesterAvatar({
      requesterAvatarUrl: "https://example.test/requester.jpg"
    }), true);
    assert.deepEqual(calls, [[
      "https://example.test/requester.jpg",
      { timeout: AVATAR_PRELOAD_TIMEOUT_MS }
    ]]);
  } finally {
    avatarCache.warmAvatar = original;
  }
});

test("avatar preloader safely skips missing and invalid URLs", async () => {
  const original = avatarCache.warmAvatar;
  let calls = 0;
  avatarCache.warmAvatar = async () => { calls++; return null; };
  try {
    assert.equal(await prepareRequesterAvatar({ requesterAvatarUrl: "" }), false);
    assert.equal(await prepareRequesterAvatar({ requesterAvatarUrl: "file:///tmp/avatar.png" }), false);
    assert.equal(calls, 0);
  } finally {
    avatarCache.warmAvatar = original;
  }
});
