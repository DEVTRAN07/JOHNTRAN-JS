"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const permissions = require("../core/runtime/middleware/permissions");
const { TRIT } = require("../core/runtime/trit");

function runFixtures() {
  const roleCases = [
    { role: 2, isBotAdmin: false },
    { role: 2, isBotAdmin: true },
    { role: 1, isBotAdmin: false, isSupport: false },
    { role: 1, isBotAdmin: false, isSupport: true },
    { role: 1, isBotAdmin: true, isSupport: false },
    { role: 0 },
    { role: "2", isBotAdmin: false },
    { role: 2, isBotAdmin: "trusted" }
  ];

  const groupCases = [
    { isGroup: false, threadInfo: { admin_only: true, support_only: true, box_only: true } },
    { isGroup: true, threadInfo: { admin_only: true, support_only: true, box_only: true } },
    { isGroup: true, threadInfo: { support_only: true, box_only: true } },
    { isGroup: true, threadInfo: { box_only: true } },
    { isGroup: true, threadInfo: { admin_only: true }, isBotAdmin: true },
    { isGroup: true, threadInfo: { support_only: true }, isSupport: true },
    { isGroup: true, threadInfo: { box_only: true }, groupAdminState: TRIT.TRUE },
    { isGroup: true, threadInfo: { box_only: true }, isBotAdmin: true },
    { isGroup: true, threadInfo: {}, isBotAdmin: "raw-admin", isSupport: "raw-support" },
    { isGroup: true, threadInfo: { admin_only: false, support_only: false, box_only: false }, groupAdminState: "1" },
    { isGroup: undefined, threadInfo: { admin_only: false, support_only: false, box_only: true } }
  ];

  const adminCases = [
    [null, "u1"],
    [undefined, "u1"],
    [{ creatorId: "u1" }, "u1"],
    [{ creatorId: 123 }, "123"],
    [{ adminIds: ["u1", "u2"] }, "u2"],
    [{ adminIds: [123] }, "123"],
    [{ adminIds: [123] }, 123],
    [{ creatorId: "u1" }, ""],
    [{ creatorId: "u1" }, null],
    [{}, 0],
    [{}, false]
  ];

  return {
    role: roleCases.map(input => permissions.checkCommandRole(input)),
    group: groupCases.map(input => permissions.evaluateGroupPermissions(input)),
    adminStates: adminCases.map(([info, uid]) => permissions.resolveGroupAdminState(info, uid))
  };
}

test("Rust permission-policy addon exports all pure authorization operations", t => {
  const diagnostics = permissions.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Permission-policy Rust functions are inactive");
  for (const name of [
    "permissionCheckCommandRole",
    "permissionEvaluateGroup",
    "permissionResolveGroupAdminState"
  ]) {
    assert.ok(diagnostics.exports.includes(name), "missing N-API export: " + name);
  }
});

test("Rust role and group policy preserve JavaScript decisions and tri-state admin semantics", t => {
  if (!permissions.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_PERMISSION_POLICY;
  try {
    process.env.JT_RUST_PERMISSION_POLICY = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_PERMISSION_POLICY;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_PERMISSION_POLICY;
    else process.env.JT_RUST_PERMISSION_POLICY = previous;
  }
});

test("group permission middleware retains its synchronous fast path and asynchronous Zalo verification", async () => {
  const fast = permissions.checkGroupPermissions({
    isGroup: true,
    threadInfo: { admin_only: true },
    isBotAdmin: true
  });
  assert.equal(typeof fast?.then, "undefined");
  assert.equal(fast.denied, null);

  const live = permissions.checkGroupPermissions({
    isGroup: true,
    threadId: "permission-policy-test",
    UIDUsage: "owner",
    threadInfo: { box_only: true },
    api: {
      async getGroupInfo(threadId) {
        return { gridInfoMap: { [threadId]: { creatorId: "owner" } } };
      }
    },
    logger: { log() {} }
  });
  assert.equal(typeof live?.then, "function");
  assert.equal((await live).denied, null);
});
