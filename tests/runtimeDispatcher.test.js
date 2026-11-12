"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchCommand } = require("../core/runtime/dispatcher");

function createContext() {
  const reactions = [];
  const errors = [];
  const tracked = [];
  const logs = [];
  const api = {
    __reply: {
      reacted: false,
      react: async icon => { reactions.push(icon); },
      error: async message => { errors.push(message); }
    }
  };
  return {
    api, reactions, errors, tracked, logs,
    logger: { log: (...args) => logs.push(args) },
    metrics: { track: (...args) => tracked.push(args) },
    Reactions: { LIKE: "like", PRAY: "working", OK: "ok", CRY: "cry" }
  };
}

test("dispatcher preserves the command plugin context and success reactions", async () => {
  const ctx = createContext();
  let received;
  await dispatchCommand({
    command: { run: async args => { received = args; } },
    commandName: "hello",
    args: ["world"],
    event: { data: { content: "hello world", uidFrom: "u1" }, mentions: [{ uid: "u2" }] },
    api: ctx.api,
    Users: {}, Threads: {}, threadData: { data: {} }, userData: { name: "A" },
    logger: ctx.logger, metrics: ctx.metrics, Reactions: ctx.Reactions
  });
  assert.deepEqual(received.args, ["world"]);
  assert.deepEqual(received.mentions, [{ uid: "u2" }]);
  assert.equal(received.userData.name, "A");
  assert.deepEqual(ctx.reactions, ["working", "ok"]);
  assert.deepEqual(ctx.tracked, [["command", { command: "hello" }]]);
  assert.equal(ctx.errors.length, 0);
});

test("dispatcher isolates command failures and reports failure reaction", async () => {
  const ctx = createContext();
  await dispatchCommand({
    command: { run: async () => { throw new Error("broken"); } },
    commandName: "broken",
    args: [],
    event: { data: {}, mentions: [] },
    api: ctx.api,
    logger: ctx.logger, metrics: ctx.metrics, Reactions: ctx.Reactions
  });
  assert.deepEqual(ctx.reactions, ["working", "cry"]);
  assert.deepEqual(ctx.errors, ["Đã xảy ra lỗi khi xử lý lệnh!"]);
  assert.deepEqual(ctx.tracked, [
    ["command", { command: "broken" }],
    ["error", { command: "broken" }]
  ]);
  assert.match(ctx.logs[0][0], /broken/);
});
