"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stats = require("../core/stats");

test("bot profile fills a missing avatar from Zalo's UID-scoped avatar endpoint", async () => {
  stats.invalidate();
  const uid = "johntran-bot-avatar-uid";
  const avatar = "https://cdn.example/johntran-bot-avatar.jpg";
  let avatarCalls = 0;

  const api = {
    getOwnId: async () => uid,
    fetchAccountInfo: async () => ({
      profile: { userId: uid, displayName: "JOHNTRAN Bot" }
    }),
    getAvatarUrlProfile: async requestedUid => {
      avatarCalls++;
      assert.equal(requestedUid, uid);
      return {
        [requestedUid + "_0"]: { avatar }
      };
    }
  };

  try {
    const first = await stats.getProfile(api);
    assert.equal(first.displayName, "JOHNTRAN Bot");
    assert.equal(first.avatar, "");

    await new Promise(resolve => setTimeout(resolve, 10));
    const second = await stats.getProfile(api);
    assert.equal(second.avatar, avatar);
    assert.equal(stats.getCachedProfile().avatar, avatar);
    assert.equal(avatarCalls, 1);
  } finally {
    stats.invalidate();
  }
});

test("bot profile does not request a second avatar when account info already contains one", async () => {
  stats.invalidate();
  let avatarCalls = 0;
  const avatar = "https://cdn.example/already-present.jpg";

  try {
    const profile = await stats.getProfile({
      getOwnId: async () => "johntran-bot-existing-uid",
      fetchAccountInfo: async () => ({
        profile: {
          userId: "johntran-bot-existing-uid",
          displayName: "JOHNTRAN",
          avatar
        }
      }),
      getAvatarUrlProfile: async () => {
        avatarCalls++;
        return {};
      }
    });

    assert.equal(profile.avatar, avatar);
    assert.equal(avatarCalls, 0);
  } finally {
    stats.invalidate();
  }
});
