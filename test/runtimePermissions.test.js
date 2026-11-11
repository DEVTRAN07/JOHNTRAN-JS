"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkCommandRole, checkGroupPermissions } = require("../core/runtime/middleware/permissions");

test("role middleware preserves admin and support access rules", () => {
  assert.ok(checkCommandRole({ role: 2, isBotAdmin: false }).denied);
  assert.equal(checkCommandRole({ role: 2, isBotAdmin: true }).denied, null);
  assert.ok(checkCommandRole({ role: 1, isBotAdmin: false, isSupport: false }).denied);
  assert.equal(checkCommandRole({ role: 1, isSupport: true }).denied, null);
  assert.equal(checkCommandRole({ role: 0 }).denied, null);
});

test("group restrictions deny non-admins in the same order as legacy handler", async () => {
  const adminOnly = await checkGroupPermissions({
    isGroup: true, UIDUsage: "u1", threadInfo: { admin_only: true }
  });
  assert.match(adminOnly.denied, /admin bot/);

  const supportOnly = await checkGroupPermissions({
    isGroup: true, UIDUsage: "u1", threadInfo: { support_only: true }
  });
  assert.match(supportOnly.denied, /support bot/);

  const boxOnly = await checkGroupPermissions({
    isGroup: true, UIDUsage: "u1", threadInfo: { box_only: true },
    api: { getGroupInfo: async () => ({ gridInfoMap: { g1: { creatorId: "owner" } } }) },
    threadId: "g1"
  });
  assert.match(boxOnly.denied, /trưởng nhóm/);
});

test("group owner and bot admin pass box-only restrictions", async () => {
  const owner = await checkGroupPermissions({
    isGroup: true, threadId: "g1", UIDUsage: "owner", threadInfo: { box_only: true },
    api: { getGroupInfo: async () => ({ gridInfoMap: { g1: { creatorId: "owner" } } }) }
  });
  assert.equal(owner.denied, null);
  const botAdmin = await checkGroupPermissions({
    isGroup: true, UIDUsage: "bot", isBotAdmin: true, threadInfo: { box_only: true },
    api: { getGroupInfo: async () => { throw new Error("should not be called"); } }
  });
  assert.equal(botAdmin.denied, null);
});

test("private messages skip group-only restrictions", async () => {
  const result = await checkGroupPermissions({
    isGroup: false, UIDUsage: "u1",
    threadInfo: { admin_only: true, support_only: true, box_only: true }
  });
  assert.equal(result.denied, null);
});
