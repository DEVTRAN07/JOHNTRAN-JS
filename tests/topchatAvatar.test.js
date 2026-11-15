"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const requesterProfile = require("../core/runtime/requesterProfile");
const topchat = require("../plugins/commands/topchat");

test("topchat avatar lookup can finish within its own wait budget", async () => {
  const original = requesterProfile.getUserAvatar;
  const seen = [];
  requesterProfile.getUserAvatar = async (_api, uid, options) => {
    seen.push({ uid, options });
    return "https://cdn.example/" + uid + ".jpg";
  };

  try {
    const ranking = [
      { uid: "member-one", name: "One", count: 5, avatar: "" },
      { uid: "member-two", name: "Two", count: 4, avatar: "" }
    ];
    const result = await topchat._test.hydrateRankingAvatars({}, ranking);

    assert.equal(result[0].avatar, "https://cdn.example/member-one.jpg");
    assert.equal(result[1].avatar, "https://cdn.example/member-two.jpg");
    assert.equal(seen.length, 2);
    for (const item of seen) {
      assert.equal(item.options.waitMs, topchat._test.AVATAR_LOOKUP_TIMEOUT_MS);
      assert.ok(
        item.options.fetchTimeoutMs < item.options.waitMs,
        "the internal API timeout must finish before the outer profile wait expires"
      );
      assert.equal(item.options.fetchTimeoutMs, topchat._test.AVATAR_LOOKUP_TIMEOUT_MS - 50);
    }
  } finally {
    requesterProfile.getUserAvatar = original;
  }
});
