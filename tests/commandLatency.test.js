"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handleCommand = require("../core/handle/handleCommand");
const metrics = require("../core/metrics");

test("command latency includes an unknown-command response before dispatch", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;

  global.config = { prefix: "/", allow_private_command: true };
  global.client = { commands: new Map(), cooldowns: new Map() };

  const before = metrics.getLatencyStats().count;
  const previousPipelineCount = metrics.getCommandLatencyStats(100).find(item => item.command === "not-a-real-command")?.count || 0;
  const api = {
    async sendMessage() {
      return { message: { msgId: 77, cliMsgId: 77 } };
    }
  };
  const event = {
    threadId: "latency-unknown-group",
    type: 2,
    data: { uidFrom: "latency-unknown-user", content: "/not-a-real-command" }
  };

  try {
    await handleCommand("/not-a-real-command", event, api, {}, "/", { data: {} });
    const after = metrics.getLatencyStats().count;
    const pipelineCount = metrics.getCommandLatencyStats(100).find(item => item.command === "not-a-real-command")?.count || 0;
    assert.equal(after, before + 1);
    assert.equal(pipelineCount, previousPipelineCount + 1, "unknown-command early returns must be included in end-to-end command latency");
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
  }
});


test("pipeline failures are counted once and still propagate to the listener", async () => {
  const { ThreadType } = require("zalo-client");
  const previousConfig = global.config;
  const originalTrack = metrics.track;
  const tracked = [];

  global.config = new Proxy({}, {
    get(_target, property) {
      if (property === "allow_private_command") {
        throw new Error("simulated private-command config failure");
      }
      return undefined;
    }
  });
  metrics.track = (...args) => tracked.push(args);

  try {
    await assert.rejects(
      handleCommand(
        "/pipelinebroken",
        {
          threadId: "pipeline-error-group",
          type: ThreadType.User,
          data: { uidFrom: "pipeline-error-user", content: "/pipelinebroken" }
        },
        {},
        {},
        "/",
        { data: {} }
      ),
      /simulated private-command config failure/
    );
    assert.deepEqual(tracked, [[
      "error",
      { command: "pipelinebroken", source: "pipeline" }
    ]]);
  } finally {
    metrics.track = originalTrack;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});
