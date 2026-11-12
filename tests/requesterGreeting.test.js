"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const greeting = require("../core/runtime/requesterGreeting");

test("requester greeting distinguishes owner, other admin, support and users", () => {
  const oldConfig = global.config;
  const oldUsers = global.users;
  global.config = { admin_bot: ["owner-1", "admin-2"], support_bot: ["support-3"] };
  global.users = { admin: [12345], support: ["support-3"] };

  try {
    assert.equal(greeting.getRequesterGreeting("owner-1"), "👑 Chào chủ nhân!");
    assert.equal(greeting.getRequesterGreeting("admin-2"), "🛡️ Chào quản trị viên!");
    assert.equal(greeting.getRequesterGreeting("12345"), "🛡️ Chào quản trị viên!");
    assert.equal(greeting.getRequesterGreeting("support-3"), "✨ Chào trợ lý!");
    assert.equal(greeting.getRequesterGreeting("member-4"), "🤖 Chào bạn!");
  } finally {
    global.config = oldConfig;
    global.users = oldUsers;
  }
});

test("UID comparison is consistent across number and string values", () => {
  assert.equal(greeting.isBotAdmin(12345), true);
  assert.equal(greeting.isBotAdmin("12345"), true);
});
