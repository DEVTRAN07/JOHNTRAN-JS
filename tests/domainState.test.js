"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const groupPolicy = require("../src/domain/groups/botState");
const antiProtection = require("../src/domain/moderation/protectionState");

test("group bot policy accepts only explicit boolean true", () => {
  assert.equal(groupPolicy.isEnabled({ data: { bot_enabled: true } }), true);
  assert.equal(groupPolicy.isEnabled({ bot_enabled: 1 }), false);
  assert.equal(groupPolicy.isEnabled({ data: {} }), false);
  assert.equal(groupPolicy.isEnabled(null), false);
});

test("only /bot on and /bot status bypass the group OFF gate", () => {
  assert.equal(groupPolicy.canRunCommandInGroup({ bot_enabled: false }, "bot", ["on"]), true);
  assert.equal(groupPolicy.canRunCommandInGroup({ bot_enabled: false }, "BOT", ["status"]), true);
  assert.equal(groupPolicy.canRunCommandInGroup({ bot_enabled: false }, "menu", []), false);
  assert.equal(groupPolicy.canRunCommandInGroup({ bot_enabled: true }, "menu", []), true);
});

test("group control message parsing respects prefix and first argument", () => {
  assert.equal(groupPolicy.isAllowedControlMessage("/bot on", "/"), true);
  assert.equal(groupPolicy.isAllowedControlMessage("/bot status", "/"), true);
  assert.equal(groupPolicy.isAllowedControlMessage("/bot off", "/"), false);
  assert.equal(groupPolicy.isAllowedControlMessage("bot on", "/"), false);
  assert.equal(groupPolicy.isAllowedControlMessage("/bot on", ""), false);
});

test("group state summaries preserve other group fields and strict ON values", () => {
  const groups = [{ gid: "g1", name: "One" }, { gid: "g2", name: "Two" }];
  const records = [
    { threadId: "g1", data: { bot_enabled: true } },
    { threadId: "g2", data: { bot_enabled: "true" } }
  ];
  assert.deepEqual(groupPolicy.attachGroupBotState(groups, records), [
    { gid: "g1", name: "One", botEnabled: true },
    { gid: "g2", name: "Two", botEnabled: false }
  ]);
  assert.deepEqual(groupPolicy.getGroupBotStateSnapshot(records), [
    { gid: "g1", botEnabled: true },
    { gid: "g2", botEnabled: false }
  ]);
});

test("Anti protection state includes every supported key with strict booleans", () => {
  const state = antiProtection.getAntiProtectionState({
    anti_nude: true, anti_undo: 1, anti_link: false, anti_qr: true
  });
  assert.equal(state.anti_nude, true);
  assert.equal(state.anti_undo, false);
  assert.equal(state.anti_link, false);
  assert.equal(state.anti_qr, true);
  assert.equal(Object.keys(state).length, antiProtection.ANTI_PROTECTION_KEYS.length);
});

test("Anti protection updates mutate only the selected key and preserve unrelated settings", () => {
  const data = { bot_enabled: true, disabled_commands: ["menu"], anti_nude_warnings: { user: 2 } };
  const state = antiProtection.setAntiProtectionState(data, "anti_sticker", true);
  assert.equal(data.anti_sticker, true);
  assert.equal(data.bot_enabled, true);
  assert.deepEqual(data.disabled_commands, ["menu"]);
  assert.deepEqual(data.anti_nude_warnings, { user: 2 });
  assert.equal(state.anti_sticker, true);
});

test("Anti protection validation rejects unknown keys, non-booleans and invalid data", () => {
  assert.throws(() => antiProtection.setAntiProtectionState({}, "anti_unknown", true), /không hợp lệ/);
  assert.throws(() => antiProtection.setAntiProtectionState({}, "anti_link", "on"), /boolean/);
  assert.throws(() => antiProtection.setAntiProtectionState([], "anti_link", true), /Dữ liệu nhóm/);
});
