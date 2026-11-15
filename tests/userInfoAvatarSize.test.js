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
