"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldExecuteMessageCommand } = require("../core/listen");

test("realtime messages may execute commands", () => {
  assert.equal(shouldExecuteMessageCommand(), true);
  assert.equal(shouldExecuteMessageCommand({}), true);
});

test("history backfill never re-executes historical commands", () => {
  assert.equal(shouldExecuteMessageCommand({ skipCommandExecution: true }), false);
  assert.equal(shouldExecuteMessageCommand({ skipCommandExecution: false }), true);
});
