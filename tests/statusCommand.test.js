"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const status = require("../plugins/commands/status");

test("status recognizes group threads and defaults the bot to active", () => {
  const result = status._test.currentGroup(
    {},
    { threadId: "group-1", type: 1, data: { threadName: "Nhóm thử nghiệm" } },
    { getCachedData: () => ({ data: {} }) },
    { data: {} }
  );
  assert.equal(result.name, "Nhóm thử nghiệm");
  assert.equal(result.enabled, true);
});

test("status reports a group as off only when explicitly disabled", () => {
  const result = status._test.currentGroup(
    {},
    { threadId: "group-2", type: 1, data: { groupName: "Nhóm đã tắt" } },
    { getCachedData: () => ({ data: { bot_enabled: false } }) },
    { data: { bot_enabled: false } }
  );
  assert.equal(result.name, "Nhóm đã tắt");
  assert.equal(result.enabled, false);
});

test("status identifies private threads using Zalo ThreadType.User", () => {
  const result = status._test.currentGroup(
    {},
    { threadId: "user-1", type: 0, data: {} },
    { getCachedData: () => ({ data: {} }) },
    { data: {} }
  );
  assert.equal(result.name, "Tin nhắn riêng");
});
