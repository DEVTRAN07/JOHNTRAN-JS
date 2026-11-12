"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { clearRequesterProfileCache, getRequesterProfile } = require("../core/runtime/requesterProfile");

test("requester profile returns event fallback immediately and refreshes the remote profile in background", async () => {
  const avatarCache = require("../core/canvas/avatarCache");
  const originalWarmAvatar = avatarCache.warmAvatar;
  avatarCache.warmAvatar = async () => null;
  clearRequesterProfileCache();
  let resolveProfile;
  let calls = 0;
  const api = {
    getUserInfo() {
      calls++;
      return new Promise(resolve => { resolveProfile = resolve; });
    }
  };
  const event = {
    data: { uidFrom: "profile-test-user", dName: "Local Name" }
  };

  const started = Date.now();
  const first = await getRequesterProfile(api, event);
  assert.ok(Date.now() - started < 100, "profile lookup must not wait for the remote API");
  assert.equal(first.requesterName, "Local Name");
  assert.equal(first.requesterAvatarUrl, "");

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveProfile({
    changed_profiles: {
      "profile-test-user": {
        displayName: "Remote Name",
        avatar: "https://example.test/avatar.jpg"
      }
    }
  });
  await new Promise(resolve => setImmediate(resolve));

  const second = await getRequesterProfile(api, event);
  assert.equal(second.requesterName, "Remote Name");
  assert.equal(second.requesterAvatarUrl, "https://example.test/avatar.jpg");
  assert.equal(calls, 1);
  clearRequesterProfileCache();
  avatarCache.warmAvatar = originalWarmAvatar;
});


test("requester profile extracts the UID_0 key returned by Zalo and warms the real avatar", async () => {
  const avatarCache = require("../core/canvas/avatarCache");
  const originalWarmAvatar = avatarCache.warmAvatar;
  const warmed = [];
  const calls = [];
  const uid = "profile-uid-zero-user";
  const avatar = "https://example.test/real-user-avatar.jpg";

  avatarCache.warmAvatar = async (url) => { warmed.push(url); };
  clearRequesterProfileCache();

  const api = {
    async getUserInfo(requestedUid, avatarSize) {
      calls.push([requestedUid, avatarSize]);
      return {
        changed_profiles: {
          [requestedUid + "_0"]: {
            userId: requestedUid,
            displayName: "Real Zalo Name",
            avatar
          }
        }
      };
    }
  };

  try {
    const event = { data: { uidFrom: uid, dName: "Message Name" } };
    const first = await getRequesterProfile(api, event);
    assert.equal(first.requesterName, "Message Name");

    await new Promise(resolve => setImmediate(resolve));
    const second = await getRequesterProfile(api, event);

    assert.equal(second.requesterName, "Real Zalo Name");
    assert.equal(second.requesterAvatarUrl, avatar);
    assert.deepEqual(calls, [[uid, 240]]);
    assert.ok(warmed.includes(avatar), "real Zalo avatar should be prefetched into the image cache");
  } finally {
    avatarCache.warmAvatar = originalWarmAvatar;
    clearRequesterProfileCache();
  }
});
