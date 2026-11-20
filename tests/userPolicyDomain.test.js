"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../src/domain/users/requesterGreeting");

const config = {
  owner_uid: "owner",
  admin_bot: ["owner", "admin"],
  support_bot: ["support"]
};
const users = {
  admin: ["runtime-admin"],
  support: ["runtime-support"]
};

test("user policy distinguishes owner, configured admin, runtime admin and support", () => {
  assert.equal(policy.isBotOwner("owner", config), true);
  assert.equal(policy.isBotOwner("admin", config), false);
  assert.equal(policy.isBotAdmin("admin", config, users), true);
  assert.equal(policy.isBotAdmin("runtime-admin", config, users), true);
  assert.equal(policy.isSupportUser("support", config, users), true);
  assert.equal(policy.isSupportUser("runtime-support", config, users), true);
});

test("runtime admin membership never promotes a user to owner", () => {
  const runtimeOnly = { admin: ["not-owner"], support: [] };
  assert.equal(policy.isBotAdmin("not-owner", { admin_bot: [] }, runtimeOnly), true);
  assert.equal(policy.isBotOwner("not-owner", { admin_bot: [] }), false);
});

test("greetings and prompts use explicit identity data deterministically", () => {
  assert.equal(policy.getRequesterGreeting("owner", config, users), "🤖 Chào chủ nhân!");
  assert.equal(policy.getRequesterGreeting("admin", config, users), "🛡️ Chào quản trị viên!");
  assert.equal(policy.getRequesterGreeting("support", config, users), "✨ Chào trợ lý!");
  assert.equal(policy.getRequesterGreeting("guest", config, users), "🤖 Chào bạn!");
  assert.match(policy.getRequesterPrompt("owner", config, users), /chủ nhân/);
  assert.match(policy.getRequesterPrompt("guest", config, users), /khám phá/);
});
