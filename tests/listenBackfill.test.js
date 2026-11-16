"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldExecuteMessageCommand } = require("../core/listen");
const {
  isEnabled: isGroupBotEnabled,
  isAllowedControl,
  isAllowedControlMessage,
  canRunCommandInGroup
} = require("../core/runtime/groupBotState");

test("realtime messages may execute commands", () => {
  assert.equal(shouldExecuteMessageCommand(), true);
  assert.equal(shouldExecuteMessageCommand({}), true);
});

test("history backfill never re-executes historical commands", () => {
  assert.equal(shouldExecuteMessageCommand({ skipCommandExecution: true }), false);
  assert.equal(shouldExecuteMessageCommand({ skipCommandExecution: false }), true);
});

test("new groups and legacy records without bot_enabled are OFF", () => {
  assert.equal(isGroupBotEnabled(undefined), false);
  assert.equal(isGroupBotEnabled({}), false);
  assert.equal(isGroupBotEnabled({ data: {} }), false);
  assert.equal(isGroupBotEnabled({ data: { bot_enabled: false } }), false);
  assert.equal(isGroupBotEnabled({ data: { bot_enabled: true } }), true);
});

test("only /bot on and /bot status can run while a group is OFF", () => {
  const disabled = { bot_enabled: false };
  assert.equal(canRunCommandInGroup(disabled, "help", []), false);
  assert.equal(canRunCommandInGroup(disabled, "bot", ["off"]), false);
  assert.equal(canRunCommandInGroup(disabled, "bot", ["on"]), true);
  assert.equal(canRunCommandInGroup(disabled, "bot", ["status"]), true);
  assert.equal(isAllowedControl("bot", ["status"]), true);
  assert.equal(isAllowedControlMessage("/bot on", "/"), true);
  assert.equal(isAllowedControlMessage("/menu", "/"), false);
  assert.equal(isAllowedControlMessage("!bot on", "/"), false);
});
