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
    assert.equal(after, before + 1);
  } finally {
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
  }
});
