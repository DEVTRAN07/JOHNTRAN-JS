"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { requestHandler } = require("../core/health");

function request(path, authorization) {
  const response = {
    status: 0,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
  requestHandler({
    url: path,
    headers: {
      host: "0.0.0.0",
      ...(authorization ? { authorization } : {})
    }
  }, response);
  return response;
}

test("protected /metrics exposes command latency, event-loop pressure and queue state", () => {
  const previousConfig = global.config;
  const token = "test-panel-token-".padEnd(48, "x");
  global.config = { panel: { token } };
  try {
    const response = request("/metrics", "Bearer " + token);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.commandLatency));
    assert.ok(Array.isArray(payload.commandExecutionLatency));
    assert.ok(payload.firstResponseLatency && typeof payload.firstResponseLatency.count === "number");
    assert.ok(Array.isArray(payload.listenerStageLatency));
    assert.ok(Array.isArray(payload.zaloApiLatency));
    assert.ok(payload.eventLoop && typeof payload.eventLoop.p95Ms === "number");
    assert.ok(payload.jobQueues && typeof payload.jobQueues.global === "object");
    assert.ok(payload.workers && typeof payload.workers === "object");
    assert.ok(payload.messageCache && typeof payload.messageCache.fullScans === "number");
  } finally {
    global.config = previousConfig;
  }
});

test("detailed /metrics remains protected", () => {
  const previousConfig = global.config;
  global.config = { panel: { token: "test-panel-token-".padEnd(48, "x") } };
  try {
    const response = request("/metrics");
    assert.equal(response.status, 401);
  } finally {
    global.config = previousConfig;
  }
});
