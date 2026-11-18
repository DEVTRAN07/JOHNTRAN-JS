"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchCommand } = require("../core/runtime/dispatcher");

function createContext() {
  const reactions = [];
  const errors = [];
  const tracked = [];
  const executionLatencies = [];
  const logs = [];
  const reply = {
    reacted: false,
    _responseStarted: false,
    _commandCompleted: false,
    _ackTimer: null,
    scheduleAcknowledgement(callback, delayMs = 600) {
      this.cancelAcknowledgement();
      this._ackTimer = setTimeout(() => {
        this._ackTimer = null;
        if (!this._responseStarted && !this._commandCompleted) callback();
      }, delayMs);
      this._ackTimer.unref?.();
      return true;
    },
    cancelAcknowledgement() {
      if (this._ackTimer) clearTimeout(this._ackTimer);
      this._ackTimer = null;
    },
    markResponseStarted() {
      this._responseStarted = true;
      this.cancelAcknowledgement();
    },
    finishCommand() {
      this._commandCompleted = true;
      this.cancelAcknowledgement();
    },
    react: async icon => {
      reply.reacted = true;
      reactions.push(icon);
    },
    error: async message => {
      errors.push(message);
      reply.markResponseStarted();
    }
  };
  const api = { __reply: reply };
  return {
    api, reactions, errors, tracked, executionLatencies, logs,
    logger: { log: (...args) => logs.push(args) },
    metrics: {
      track: (...args) => tracked.push(args),
      trackCommandExecutionLatency: (...args) => executionLatencies.push(args)
    },
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
  assert.deepEqual(ctx.reactions, ["ok"]);
  assert.deepEqual(ctx.tracked, [["command", { command: "hello" }]]);
  assert.equal(ctx.executionLatencies.length, 1);
  assert.equal(ctx.executionLatencies[0][0], "hello");
  assert.ok(ctx.executionLatencies[0][1] >= 0);
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
  assert.deepEqual(ctx.reactions, ["cry"]);
  assert.deepEqual(ctx.errors, ["Đã xảy ra lỗi khi xử lý lệnh!"]);
  assert.deepEqual(ctx.tracked, [
    ["command", { command: "broken" }],
    ["error", { command: "broken" }]
  ]);
  assert.equal(ctx.executionLatencies.length, 1);
  assert.equal(ctx.executionLatencies[0][0], "broken");
  assert.ok(ctx.executionLatencies[0][1] >= 0);
  assert.match(ctx.logs[0][0], /broken/);
});

test("dispatcher shows a working reaction only after the acknowledgement delay", async () => {
  const ctx = createContext();
  await dispatchCommand({
    command: {
      config: { ackDelayMs: 5 },
      run: async () => new Promise(resolve => setTimeout(resolve, 25))
    },
    commandName: "slow",
    args: [],
    event: { data: {}, mentions: [] },
    api: ctx.api,
    logger: ctx.logger, metrics: ctx.metrics, Reactions: ctx.Reactions
  });
  assert.deepEqual(ctx.reactions, ["working", "ok"]);
});

test("dispatcher cancels the working reaction when the first reply starts", async () => {
  const ctx = createContext();
  await dispatchCommand({
    command: {
      config: { ackDelayMs: 5 },
      run: async ({ reply }) => {
        reply.markResponseStarted();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    },
    commandName: "fast-reply",
    args: [],
    event: { data: {}, mentions: [] },
    api: ctx.api,
    logger: ctx.logger, metrics: ctx.metrics, Reactions: ctx.Reactions
  });
  assert.deepEqual(ctx.reactions, []);
});
