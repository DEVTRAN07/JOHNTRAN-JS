"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const avatarCache = require("../core/canvas/avatarCache");
const { prepareRequesterAvatar, prepareCanvasAvatars, collectAvatarUrls, AVATAR_PRELOAD_TIMEOUT_MS, MAX_CARD_AVATARS } = require("../core/canvas/prepareRequesterAvatar");

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

test("Canvas worker preloads topchat, status and group avatars before render", async () => {
  const original = avatarCache.warmAvatar;
  const calls = [];
  avatarCache.warmAvatar = async (url, options) => {
    calls.push({ url, options });
    return { width: 10, height: 10 };
  };
  try {
    const topchat = await prepareCanvasAvatars("topchat", {
      ranking: [
        { avatar: "https://cdn.example/a.jpg" },
        { avatar: "https://cdn.example/b.jpg" },
        { avatar: "https://cdn.example/c.jpg" },
        { avatar: "https://cdn.example/d.jpg" },
        { avatar: "https://cdn.example/e.jpg" }
      ]
    });
    assert.equal(topchat.requested, MAX_CARD_AVATARS);
    assert.equal(topchat.loaded, MAX_CARD_AVATARS);
    assert.equal(calls.length, MAX_CARD_AVATARS);

    calls.length = 0;
    const status = await prepareCanvasAvatars("status", { botAvatar: "https://cdn.example/bot.jpg" });
    assert.deepEqual(status, { requested: 1, loaded: 1 });
    assert.equal(calls[0].url, "https://cdn.example/bot.jpg");

    calls.length = 0;
    const groups = await prepareCanvasAvatars("bot-groups", {
      groups: [{ avatar: "https://cdn.example/group.jpg" }]
    });
    assert.deepEqual(groups, { requested: 1, loaded: 1 });
  } finally {
    avatarCache.warmAvatar = original;
  }
});

test("avatar URL collection ignores missing entries and deduplicates repeated avatars", () => {
  assert.deepEqual(
    collectAvatarUrls("topchat", {
      ranking: [
        { avatar: "https://cdn.example/a.jpg" },
        { avatar: "" },
        { avatar: "https://cdn.example/a.jpg" }
      ]
    }),
    ["https://cdn.example/a.jpg", "", "https://cdn.example/a.jpg"]
  );
});
