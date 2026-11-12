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



test("requester profile uses Zalo's avatar endpoint when profile is unchanged", async () => {
  const avatarCache = require("../core/canvas/avatarCache");
  const originalWarmAvatar = avatarCache.warmAvatar;
  const uid = "profile-unchanged-user";
  const avatar = "https://example.test/direct-avatar.jpg";
  const calls = [];

  avatarCache.warmAvatar = async () => null;
  clearRequesterProfileCache();
  try {
    const profile = await getRequesterProfile({
      async getUserInfo(requestedUid, size) {
        calls.push(["getUserInfo", requestedUid, size]);
        return {
          changed_profiles: {},
          unchanged_profiles: {
            [requestedUid + "_0"]: { isFr: 1, isBlocked: false }
          }
        };
      },
      async getAvatarUrlProfile(requestedUid, size) {
        calls.push(["getAvatarUrlProfile", requestedUid, size]);
        return { [requestedUid + "_0"]: { avatar } };
      }
    }, { data: { uidFrom: uid, dName: "Event Name" } }, {
      waitMs: 300,
      skipAvatarWarm: true
    });

    assert.equal(profile.requesterName, "Event Name");
    assert.equal(profile.requesterAvatarUrl, avatar);
    assert.deepEqual(calls, [
      ["getUserInfo", uid, 240],
      ["getAvatarUrlProfile", uid, 240]
    ]);
  } finally {
    avatarCache.warmAvatar = originalWarmAvatar;
    clearRequesterProfileCache();
  }
});

test("visual menu profile lookup returns a fast UID_0 profile and waits for avatar cache warmup", async () => {
  const avatarCache = require("../core/canvas/avatarCache");
  const originalWarmAvatar = avatarCache.warmAvatar;
  const avatar = "https://example.test/first-menu-avatar.jpg";
  const uid = "profile-first-menu-user";
  avatarCache.warmAvatar = async () => null;
  clearRequesterProfileCache();

  try {
    const result = await getRequesterProfile({
      async getUserInfo(requestedUid, size) {
        assert.equal(requestedUid, uid);
        assert.equal(size, 240);
        return {
          changed_profiles: {
            [requestedUid + "_0"]: {
              userId: requestedUid,
              displayName: "Menu Owner",
              avatar
            }
          }
        };
      }
    }, {
      data: { uidFrom: uid, dName: "Fallback Name" }
    }, { waitMs: 90, avatarWaitMs: 110 });

    assert.equal(result.requesterName, "Menu Owner");
    assert.equal(result.requesterAvatarUrl, avatar);
  } finally {
    avatarCache.warmAvatar = originalWarmAvatar;
    clearRequesterProfileCache();
  }
});

test("requester avatar parser handles nested Zalo avatar records and uid arrays", () => {
  const { pickAvatarByUid, pickProfileByUid } = require("../core/runtime/requesterProfile");
  const uid = "nested-avatar-user";
  const avatar = "https://example.test/nested-avatar.jpg";
  const response = {
    data: {
      avatars: [{ userId: uid + "_0", avatar_url: avatar }]
    }
  };
  assert.equal(pickAvatarByUid(response, uid), avatar);
  assert.deepEqual(
    pickProfileByUid({
      result: {
        changed_profiles: {
          [uid + "_0"]: { userId: uid, displayName: "Nested Profile" }
        }
      }
    }, uid),
    { userId: uid, displayName: "Nested Profile" }
  );
});


test("requester avatar parser unwraps nested avatar objects", () => {
  const { pickAvatar, pickAvatarByUid } = require("../core/runtime/requesterProfile");
  const avatar = "https://example.test/avatar-object.jpg";
  assert.equal(pickAvatar({ avatar: { url: avatar } }), avatar);
  assert.equal(pickAvatarByUid({
    data: { user: { uid: "avatar-object-user", profilePicture: { href: avatar } } }
  }, "avatar-object-user"), avatar);
});
