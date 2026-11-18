"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyBotGroupRole,
  getBotGroupRole,
  hasBotGroupKey,
  collectBotGroupKeys
} = require("../core/runtime/botGroupKey");

test("classifies the bot as group owner, deputy, member, or unknown", () => {
  assert.equal(classifyBotGroupRole({ creatorId: "bot", adminIds: [] }, "bot"), "owner");
  assert.equal(classifyBotGroupRole({ creatorId: "owner", adminIds: ["bot"] }, "bot"), "deputy");
  assert.equal(classifyBotGroupRole({ creatorId: "owner", adminIds: ["deputy"] }, "bot"), "member");
  assert.equal(classifyBotGroupRole({ creatorId: "owner" }, "bot"), "unknown");
  assert.equal(classifyBotGroupRole(null, "bot"), "unknown");
});

test("checks bot key by its own Zalo UID and caches the group lookup", async () => {
  const calls = { ownId: 0, groupInfo: 0 };
  const api = {
    getOwnId() {
      calls.ownId++;
      return "bot";
    },
    async getGroupInfo(groupId) {
      calls.groupInfo++;
      return { gridInfoMap: { [groupId]: { creatorId: "owner", adminIds: ["bot"] } } };
    }
  };

  assert.equal(await hasBotGroupKey(api, "group-1"), true);
  assert.equal(await getBotGroupRole(api, "group-1"), "deputy");
  assert.deepEqual(calls, { ownId: 1, groupInfo: 1 });
});

test("collects all joined groups and returns the bot's QTV group names", async () => {
  const requested = [];
  const api = {
    getOwnId() { return "bot"; },
    async getAllGroups() {
      return { gridVerMap: { ownerGroup: "1", deputyGroup: "1", memberGroup: "1" } };
    },
    async getGroupInfo(groupIds) {
      requested.push(groupIds);
      const entries = {
        ownerGroup: { name: "Nhóm trưởng", creatorId: "bot", adminIds: [] },
        deputyGroup: { name: "Nhóm phó", creatorId: "other", adminIds: ["bot"] },
        memberGroup: { name: "Nhóm thành viên", creatorId: "other", adminIds: ["admin"] }
      };
      return {
        gridInfoMap: Object.fromEntries(groupIds.map(id => [id, entries[id]]))
      };
    }
  };

  const summary = await collectBotGroupKeys(api);
  assert.equal(summary.totalGroups, 3);
  assert.equal(summary.keyGroups.length, 2);
  assert.equal(summary.ownerCount, 1);
  assert.equal(summary.deputyCount, 1);
  assert.deepEqual(summary.keyGroups.map(group => group.name), ["Nhóm trưởng", "Nhóm phó"]);
  assert.equal(summary.noKeyGroups.length, 1);
  assert.equal(summary.unknownGroups.length, 0);
  assert.equal(requested.length, 1);
  assert.deepEqual(requested[0], ["ownerGroup", "deputyGroup", "memberGroup"]);
});
