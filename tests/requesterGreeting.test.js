"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const greeting = require("../core/runtime/requesterGreeting");

test("only the configured primary owner receives the owner greeting and prompt", () => {
  const oldConfig = global.config, oldUsers = global.users;
  global.config = { admin_bot: ["owner-1", "admin-2"], support_bot: ["support-3"] };
  global.users = { admin: [12345, "admin-2"], support: ["support-3"] };
  try {
    assert.equal(greeting.getBotOwnerId(), "owner-1");
    assert.equal(greeting.isBotOwner("owner-1"), true);
    assert.equal(greeting.getRequesterGreeting("owner-1"), "🤖 Chào chủ nhân!");
    assert.equal(greeting.getRequesterPrompt("owner-1"), "👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀");
    for (const uid of ["admin-2", "12345", "support-3", "member-4"]) {
      assert.doesNotMatch(greeting.getRequesterGreeting(uid), /chủ nhân/i);
      assert.doesNotMatch(greeting.getRequesterPrompt(uid), /chủ nhân/i);
    }
    assert.equal(greeting.getRequesterGreeting("admin-2"), "🛡️ Chào quản trị viên!");
    assert.equal(greeting.getRequesterGreeting("support-3"), "✨ Chào trợ lý!");
    assert.equal(greeting.getRequesterGreeting("member-4"), "🤖 Chào bạn!");
  } finally { global.config = oldConfig; global.users = oldUsers; }
});

test("a runtime admin is not incorrectly promoted to bot owner", () => {
  const oldConfig = global.config, oldUsers = global.users;
  global.config = { admin_bot: [] }; global.users = { admin: ["admin-only"] };
  try {
    assert.equal(greeting.isBotAdmin("admin-only"), true);
    assert.equal(greeting.isBotOwner("admin-only"), false);
    assert.equal(greeting.getRequesterGreeting("admin-only"), "🛡️ Chào quản trị viên!");
  } finally { global.config = oldConfig; global.users = oldUsers; }
});

test("an explicit owner UID takes precedence over the admin list", () => {
  const oldConfig = global.config, oldUsers = global.users;
  global.config = { owner_uid: 98765, admin_bot: ["admin-1"] }; global.users = { admin: ["admin-1"] };
  try {
    assert.equal(greeting.getBotOwnerId(), "98765");
    assert.equal(greeting.isBotOwner(98765), true);
    assert.equal(greeting.isBotOwner("admin-1"), false);
  } finally { global.config = oldConfig; global.users = oldUsers; }
});

test("UID comparison is consistent across number and string values", () => {
  const oldConfig = global.config, oldUsers = global.users;
  global.config = { admin_bot: [] }; global.users = { admin: [12345] };
  try {
    assert.equal(greeting.isBotAdmin(12345), true);
    assert.equal(greeting.isBotAdmin("12345"), true);
  } finally { global.config = oldConfig; global.users = oldUsers; }
});
