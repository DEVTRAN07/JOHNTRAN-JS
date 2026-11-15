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

test("fetchProfile falls back to Zalo's dedicated avatar endpoint when user info omits an avatar", async () => {
  const { fetchProfile } = require("../core/zaloProfile");
  const avatarCalls = [];
  const api = {
    getUserInfo: async uid => ({
      changed_profiles: {
        [uid + "_0"]: { userId: uid, displayName: "Avatar Missing User" }
      }
    }),
    getAvatarUrlProfile: async (uid, size) => {
      avatarCalls.push([uid, size]);
      return { data: { [uid + "_0"]: { avatarUrl: "https://cdn.example/" + uid + ".jpg" } } };
    }
  };

  const { user } = await fetchProfile(api, "member-avatar-fallback");
  assert.equal(user.displayName, "Avatar Missing User");
  assert.equal(user.avatar, "https://cdn.example/member-avatar-fallback.jpg");
  assert.deepEqual(avatarCalls, [["member-avatar-fallback", 240]]);
});

test("profile lookup rejects a lone profile for a different UID", async () => {
  const { fetchProfile, pickUser } = require("../core/zaloProfile");
  const targetUid = "target-user-001";
  const otherUid = "target-user-0010";
  const wrongAvatar = "https://cdn.example/wrong-person.jpg";
  let avatarCalls = 0;
  const raw = {
    changed_profiles: {
      [otherUid + "_0"]: {
        userId: otherUid,
        displayName: "Wrong Person",
        avatar: wrongAvatar
      }
    }
  };

  assert.equal(pickUser(raw, targetUid), null);
  const result = await fetchProfile({
    getUserInfo: async () => raw,
    getAvatarUrlProfile: async () => {
      avatarCalls++;
      return { [otherUid + "_0"]: { avatar: wrongAvatar } };
    }
  }, targetUid);

  assert.equal(result.user, null);
  assert.equal(avatarCalls, 0);
});

test("avatar URL lookup never falls back to another UID's avatar", () => {
  const { pickAvatarByUid } = require("../core/runtime/avatarUrl");
  const wanted = "wanted-member-123";
  const wrong = "wanted-member-1234";
  const wrongAvatar = "https://cdn.example/not-the-requested-user.jpg";

  assert.equal(pickAvatarByUid({
    data: { [wrong + "_0"]: { avatar: wrongAvatar } }
  }, wanted), "");

  assert.equal(pickAvatarByUid({
    data: { [wanted + "_0"]: { avatar: "https://cdn.example/correct.jpg" } }
  }, wanted), "https://cdn.example/correct.jpg");

  // The dedicated single-user endpoint may return a direct avatar-only object.
  assert.equal(pickAvatarByUid({
    avatarUrl: "https://cdn.example/single-user-avatar.jpg"
  }, wanted), "https://cdn.example/single-user-avatar.jpg");
});

test("fetchProfile does not call the dedicated avatar endpoint when profile already has an avatar", async () => {
  const { fetchProfile } = require("../core/zaloProfile");
  let avatarCalls = 0;
  const api = {
    getUserInfo: async uid => ({
      changed_profiles: {
        [uid + "_0"]: { userId: uid, displayName: "Existing Avatar", avatar: "https://cdn.example/existing.jpg" }
      }
    }),
    getAvatarUrlProfile: async () => { avatarCalls++; return null; }
  };

  const { user } = await fetchProfile(api, "member-avatar-existing");
  assert.equal(user.avatar, "https://cdn.example/existing.jpg");
  assert.equal(avatarCalls, 0);
});
