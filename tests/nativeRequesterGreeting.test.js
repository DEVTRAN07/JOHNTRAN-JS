"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const greeting = require("../core/runtime/requesterGreeting");

function runFixtures() {
  const config = {
    owner_uid: 0,
    owner_id: 98765,
    admin_bot: [" owner-1 ", "admin-2", "admin-2", 12345, null, "   ", "multi"],
    support_bot: ["configured-support", 555]
  };
  const users = {
    admin: ["admin-2", " runtime ", 12345, "multi"],
    support: ["runtime-support", "configured-support", false, "multi"]
  };
  const uids = [
    "98765", "owner-1", "admin-2", "12345",
    "runtime", "runtime-support", "configured-support", "multi",
    "member", null, 0, false, Symbol("symbol")
  ];

  return {
    normalized: [
      greeting.normalizeUid(null),
      greeting.normalizeUid(undefined),
      greeting.normalizeUid(12345),
      greeting.normalizeUid("\uFEFF  12345\u00A0"),
      greeting.normalizeUid("\u0085keep\u0085"),
      greeting.normalizeUid(Symbol("uid"))
    ],
    includes: [
      greeting.includesUid([" 12345 ", null, "other"], 12345),
      greeting.includesUid(["one"], ""),
      greeting.includesUid(["\uFEFF spaced"], "spaced"),
      greeting.includesUid("not-array", "not-array")
    ],
    admins: greeting.getAdminIds(config, users),
    owners: [
      greeting.getBotOwnerId(config),
      greeting.getBotOwnerId({ owner_uid: "", owner_id: "", admin_bot: ["", " primary ", "second"] }),
      greeting.getBotOwnerId({ owner_uid: false, ownerId: "legacy-owner", admin_bot: ["fallback"] }),
      greeting.getBotOwnerId({ owner_uid: [], admin_bot: [" fallback "] })
    ],
    roles: uids.map(uid => greeting.getRequesterRole(uid, config, users)),
    adminsCheck: uids.map(uid => greeting.isBotAdmin(uid, config, users)),
    supportCheck: uids.map(uid => greeting.isSupportUser(uid, config, users)),
    ownerCheck: uids.map(uid => greeting.isBotOwner(uid, config)),
    greetings: uids.map(uid => greeting.getRequesterGreeting(uid, config, users)),
    prompts: uids.map(uid => greeting.getRequesterPrompt(uid, config, users))
  };
}

test("requester-greeting Rust addon exports every policy operation", t => {
  const diagnostics = greeting.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "Requester Rust functions are inactive");
  for (const name of [
    "requesterNormalizeUid",
    "requesterIncludesUid",
    "requesterGetAdminIds",
    "requesterGetBotOwnerId",
    "requesterIsBotAdmin",
    "requesterIsSupportUser",
    "requesterIsBotOwner",
    "requesterRole"
  ]) {
    assert.ok(diagnostics.exports.includes(name), "missing N-API export: " + name);
  }
});

test("requester-greeting Rust policy preserves legacy JS normalization, roles and copy", t => {
  if (!greeting.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_REQUESTER_GREETING;
  try {
    process.env.JT_RUST_REQUESTER_GREETING = "0";
    const fallback = runFixtures();
    delete process.env.JT_RUST_REQUESTER_GREETING;
    const rust = runFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_REQUESTER_GREETING;
    else process.env.JT_RUST_REQUESTER_GREETING = previous;
  }
});

test("explicit bot owner takes precedence but runtime admins never become owner", () => {
  const config = { owner_uid: "owner-primary", admin_bot: ["configured-admin"] };
  const users = { admin: ["runtime-admin"] };
  assert.equal(greeting.getBotOwnerId(config), "owner-primary");
  assert.equal(greeting.isBotOwner("owner-primary", config), true);
  assert.equal(greeting.isBotOwner("configured-admin", config), false);
  assert.equal(greeting.isBotOwner("runtime-admin", config), false);
  assert.equal(greeting.getRequesterGreeting("runtime-admin", config, users), "🛡️ Chào quản trị viên!");
});
