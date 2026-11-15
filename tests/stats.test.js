"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const stats = require("../core/stats");

test("collectStats coalesces parallel refreshes and caches remote profile/friend/group calls", async () => {
  stats.invalidate();
  const prefix = "stats-test-" + process.pid + "-";
  let profileCalls = 0;
  let friendCalls = 0;
  let allGroupCalls = 0;
  let groupActive = 0;
  let groupMaxActive = 0;
  let groupCalls = 0;

  const gridVerMap = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [prefix + i, 1]));
  const api = {
    async getOwnId() { profileCalls++; return "bot-uid"; },
    async fetchAccountInfo() {
      profileCalls++;
      return { profile: { userId: "bot-uid", displayName: "JOHNTRAN" } };
    },
    async getAllFriends() {
      friendCalls++;
      return [{ userId: "friend-1", displayName: "Friend" }];
    },
    async getAllGroups() {
      allGroupCalls++;
      return { gridVerMap };
    },
    async getGroupInfo(gid) {
      groupCalls++;
      groupActive++;
      groupMaxActive = Math.max(groupMaxActive, groupActive);
      await new Promise(resolve => setTimeout(resolve, 3));
      groupActive--;
      return { gridInfoMap: { [gid]: { name: gid, totalMember: 5, avt: "" } } };
    }
  };

  const [first, overlapping] = await Promise.all([
    stats.collectStats(api),
    stats.collectStats(api)
  ]);

  assert.equal(first.profile.displayName, "JOHNTRAN");
  assert.equal(first.groups.total, 9);
  assert.equal(first.groups.list.length, 9);
  assert.equal(overlapping.profile.uid, "bot-uid");
  assert.equal(profileCalls, 2);
  assert.equal(friendCalls, 1);
  assert.equal(allGroupCalls, 1);
  assert.equal(groupCalls, 9);
  assert.ok(groupMaxActive > 1, "group info should not be fetched sequentially");
  assert.ok(groupMaxActive <= stats.GROUP_INFO_CONCURRENCY, "group concurrency must stay bounded");

  await stats.collectStats(api);
  assert.equal(profileCalls, 2);
  assert.equal(friendCalls, 1);
  assert.equal(allGroupCalls, 1);
  stats.invalidate();
});


test("stats normalize Zalo avatar objects for bot, friends and groups", async () => {
  stats.invalidate();
  const api = {
    async getOwnId() { return "bot-avatar-shape"; },
    async fetchAccountInfo() {
      return { profile: { userId: "bot-avatar-shape", displayName: "Bot", avatar: { url: "https://cdn.example/bot.jpg" } } };
    },
    async getAllFriends() {
      return [{ userId: "friend-avatar-shape", displayName: "Friend", avatar: { avatarUrl: "https://cdn.example/friend.jpg" } }];
    },
    async getAllGroups() { return { gridVerMap: { "group-avatar-shape": 1 } }; },
    async getGroupInfo(gid) {
      return { gridInfoMap: { [gid]: { name: "Group", avt: { url: "https://cdn.example/group.jpg" } } } };
    }
  };

  const result = await stats.collectStats(api);
  assert.equal(result.profile.avatar, "https://cdn.example/bot.jpg");
  assert.equal(result.friends.list[0].avatar, "https://cdn.example/friend.jpg");
  assert.equal(result.groups.list[0].avatar, "https://cdn.example/group.jpg");
  stats.invalidate();
});
