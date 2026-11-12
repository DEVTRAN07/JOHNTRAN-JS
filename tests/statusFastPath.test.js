"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { currentGroup } = require("../plugins/commands/status")._test;

test("status reads group enablement from the event's already-loaded thread record", () => {
  let apiCalls = 0;
  const api = {
    getGroupInfo() {
      apiCalls++;
      return new Promise(() => {});
    }
  };
  const event = {
    threadId: "status-fast-group",
    type: 2,
    data: { uidFrom: "user-1", dName: "Sender" }
  };
  const threadData = {
    threadId: "status-fast-group",
    data: { bot_enabled: true }
  };

  const started = Date.now();
  const result = currentGroup(api, event, {}, threadData);

  assert.ok(Date.now() - started < 50, "status group lookup must not wait on the Zalo API");
  assert.equal(result.id, "status-fast-group");
  assert.equal(result.enabled, true);
  assert.equal(result.name, "Nhóm hiện tại");
  assert.equal(apiCalls, 1);
});
