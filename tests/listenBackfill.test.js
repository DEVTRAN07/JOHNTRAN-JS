"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldExecuteMessageCommand } = require("../core/listen");
const {
  isEnabled: isGroupBotEnabled,
  isAllowedControl,
  isAllowedControlMessage,
  canRunCommandInGroup,
  attachGroupBotState,
  getGroupBotStateSnapshot
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

test("group browser state is ON only for records explicitly enabled in the selected bot DB", () => {
  const groups = [
    { gid: "group-on", name: "Enabled group", totalMember: 10 },
    { gid: "group-off", name: "Disabled group", totalMember: 20 },
    { gid: "group-legacy", name: "Legacy group", totalMember: 30 },
    { gid: "group-untracked", name: "Untracked group", totalMember: 40 }
  ];
  const threads = [
    { threadId: "group-on", data: { bot_enabled: true } },
    { threadId: "group-off", data: { bot_enabled: false } },
    { threadId: "group-legacy", data: {} }
  ];

  const result = attachGroupBotState(groups, threads);
  assert.deepEqual(result.map(group => [group.gid, group.botEnabled]), [
    ["group-on", true],
    ["group-off", false],
    ["group-legacy", false],
    ["group-untracked", false]
  ]);
  assert.equal(result[0].avatar, undefined);
  assert.equal(result[0].totalMember, 10);
});

test("lightweight group status snapshot reads strict bot_enabled state without loading Zalo data", () => {
  const snapshot = getGroupBotStateSnapshot([
    { threadId: "status-on", data: { bot_enabled: true } },
    { threadId: "status-off", data: { bot_enabled: false } },
    { threadId: "status-legacy", data: {} },
    { threadId: "", data: { bot_enabled: true } },
    null
  ]);
  assert.deepEqual(snapshot, [
    { gid: "status-on", botEnabled: true },
    { gid: "status-off", botEnabled: false },
    { gid: "status-legacy", botEnabled: false }
  ]);
});
