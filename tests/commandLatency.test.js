"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handleCommand = require("../core/handle/handleCommand");
const metrics = require("../core/metrics");
const { ThreadType } = require("zalo-client");

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


test("known commands expose bounded per-stage pipeline timings", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
  const previousUsers = global.users;
  const originalTrackStage = metrics.trackListenerStageLatency;
  const observed = [];
  const command = {
    config: { name: "pipelineprobe", role: 0, cooldowns: 0, preloadUserData: false },
    async run({ api: wrappedApi }) {
      await wrappedApi.sendMessage({ msg: "OK" }, "pipeline-stage-group", ThreadType.User);
    }
  };
  const api = {
    async sendMessage() {
      return { message: { msgId: 78, cliMsgId: "pipeline-stage-response" } };
    }
  };
  const event = {
    threadId: "pipeline-stage-group",
    type: ThreadType.User,
    data: { uidFrom: "pipeline-stage-user", content: "/pipelineprobe" }
  };

  global.config = { prefix: "/", allow_private_command: true, admin: {} };
  global.users = { admin: [], support: [] };
  global.client = {
    commands: new Map([["pipelineprobe", command]]),
    cooldowns: new Map()
  };
  metrics.trackListenerStageLatency = (stage, durationMs) => {
    observed.push({ stage, durationMs });
  };

  try {
    await handleCommand("/pipelineprobe", event, api, {}, "/", { data: {} });
    const stages = new Set(observed.map(item => item.stage));
    for (const expected of [
      "pipeline:resolve",
      "pipeline:group-gate",
      "pipeline:rate-limit",
      "pipeline:authorization",
      "pipeline:group-permission",
      "pipeline:cooldown",
      "pipeline:user-data"
    ]) {
      assert.ok(stages.has(expected), "missing timing for " + expected);
    }
    assert.ok(observed.every(item => Number.isFinite(item.durationMs) && item.durationMs >= 0));
  } finally {
    metrics.trackListenerStageLatency = originalTrackStage;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});


test("pipeline failures are counted once and still propagate to the listener", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
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
  global.client = { commands: new Map(), cooldowns: new Map() };
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
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
  }
});
