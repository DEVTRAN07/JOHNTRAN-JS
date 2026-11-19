"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatchCommand } = require("../core/runtime/dispatcher");

test("command errors keep a private response and log a searchable stack reference", async () => {
  const logs = [];
  const replies = [];
  const executionSamples = [];
  const errorCounters = [];
  let finished = false;

  const failure = new TypeError("synthetic command failure");
  failure.code = "ERR_SYNTHETIC_TEST";

  const reply = {
    async error(message) {
      replies.push(message);
    },
    async react(reaction) {
      replies.push("reaction:" + reaction);
    },
    cancelAcknowledgement() {},
    finishCommand() {
      finished = true;
    }
  };

  await dispatchCommand({
    command: {
      config: { name: "sample", backgroundExecution: false },
      async run() {
        throw failure;
      }
    },
    commandName: "sample",
    args: [],
    event: {
      data: {
        content: "/sample",
        msgType: "text",
        uidFrom: "user-id",
        msgId: "message-id",
        cliMsgId: "client-message-id"
      },
      mentions: [],
      type: 1,
      threadId: "group-id"
    },
    api: { __reply: reply },
    logger: {
      log(message, level, context) {
        logs.push({ message, level, context });
      }
    },
    metrics: {
      track(event, meta) {
        errorCounters.push({ event, meta });
      },
      trackCommandExecutionLatency(command, duration) {
        executionSamples.push({ command, duration });
      }
    },
    Reactions: { CRY: "cry", OK: "ok", PRAY: "pray" }
  });

  assert.equal(replies.length, 2);
  assert.match(replies[0], /^Đã xảy ra lỗi khi xử lý lệnh!\nMã lỗi: [A-F0-9]{8}$/);
  assert.equal(replies[1], "reaction:cry");
  assert.equal(finished, true);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].level, "error");
  assert.match(logs[0].message, /synthetic command failure/);
  assert.match(logs[0].message, /TypeError/);
  assert.match(logs[0].message, /\[([A-F0-9]{8})\]/);
  assert.equal(logs[0].context.source, "command");
  assert.equal(logs[0].context.commandName, "sample");
  assert.equal(logs[0].context.code, "ERR_SYNTHETIC_TEST");

  assert.deepEqual(errorCounters, [
    { event: "command", meta: { command: "sample" } },
    { event: "error", meta: { command: "sample" } }
  ]);
  assert.equal(executionSamples.length, 1);
  assert.equal(executionSamples[0].command, "sample");
  assert.ok(executionSamples[0].duration >= 0);
});

test("command error logging does not replace the original failure when metrics throws", async () => {
  const logs = [];
  const replies = [];
  const reply = {
    async error(message) { replies.push(message); },
    async react() {},
    cancelAcknowledgement() {},
    finishCommand() {}
  };

  await dispatchCommand({
    command: {
      config: { name: "metrics-failure" },
      async run() { throw new Error("original failure"); }
    },
    commandName: "metrics-failure",
    args: [],
    event: { data: {}, mentions: [], type: 0, threadId: "private-thread" },
    api: { __reply: reply },
    logger: { log(message, level, context) { logs.push({ message, level, context }); } },
    metrics: {
      track(event) {
        if (event === "error") throw new Error("metrics must not mask command error");
      },
      trackCommandExecutionLatency() {}
    },
    Reactions: { CRY: "cry" }
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /^Đã xảy ra lỗi khi xử lý lệnh!\nMã lỗi: [A-F0-9]{8}$/);
  assert.match(logs[0].message, /original failure/);
});
