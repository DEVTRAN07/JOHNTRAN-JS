"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkGroupPermissions } = require("../core/runtime/middleware/permissions");

test("ordinary groups use synchronous permission fast path without calling Zalo API", () => {
  let apiCalls = 0;
  const result = checkGroupPermissions({
    api: { getGroupInfo() { apiCalls++; throw new Error("must not be called"); } },
    threadId: "group-1",
    isGroup: true,
    UIDUsage: "user-1",
    threadInfo: {},
    logger: { log() {} }
  });

  assert.equal(typeof result?.then, "undefined");
  assert.deepEqual(result, {
    denied: null,
    isBotAdmin: false,
    isSupport: false,
    isGroupAdmin: false
  });
  assert.equal(apiCalls, 0);
});

test("admin-only and support-only checks also remain synchronous", () => {
  const adminOnly = checkGroupPermissions({
    isGroup: true,
    threadInfo: { admin_only: true }
  });
  const supportOnly = checkGroupPermissions({
    isGroup: true,
    threadInfo: { support_only: true }
  });

  assert.equal(adminOnly.denied, "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh.");
  assert.equal(supportOnly.denied, "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh.");
});

test("box-only group check waits for live group info and permits its admin", async () => {
  let apiCalls = 0;
  const result = checkGroupPermissions({
    api: {
      async getGroupInfo(threadId) {
        apiCalls++;
        return { gridInfoMap: { [threadId]: { creatorId: "user-1", adminIds: [] } } };
      }
    },
    threadId: "group-1",
    isGroup: true,
    UIDUsage: "user-1",
    threadInfo: { box_only: true },
    logger: { log() {} }
  });

  assert.equal(typeof result?.then, "function");
  assert.deepEqual(await result, {
    denied: null,
    isBotAdmin: false,
    isSupport: false,
    isGroupAdmin: true
  });
  assert.equal(apiCalls, 1);
});

test("box-only lookup failure preserves the existing deny behavior", async () => {
  const result = await checkGroupPermissions({
    api: { getGroupInfo: async () => { throw new Error("offline"); } },
    threadId: "group-1",
    isGroup: true,
    UIDUsage: "user-1",
    threadInfo: { box_only: true },
    logger: { log() {} }
  });

  assert.equal(result.denied, "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh.");
});
