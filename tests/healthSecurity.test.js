"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { requestHandler } = require("../core/health");

function request(pathname, authorization) {
  const result = { status: null, headers: {}, body: "" };
  const req = {
    url: pathname,
    headers: {
      host: "example.test",
      ...(authorization ? { authorization } : {})
    }
  };
  const res = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(body) {
      result.body = String(body || "");
    }
  };
  requestHandler(req, res);
  return result;
}

test("health stays public while operational metrics require the Panel token", () => {
  const previousConfig = global.config;
  const previousToken = process.env.JT_PANEL__TOKEN;
  const token = "panel-token-".repeat(6);

  try {
    global.config = { panel: {} };
    delete process.env.JT_PANEL__TOKEN;

    const health = request("/health");
    assert.equal(health.status, 200, "uptime checks must remain public");

    const speed = request("/speed");
    assert.equal(speed.status, 200, "aggregate latency diagnostics must be inspectable without a Panel token");
    assert.ok(Array.isArray(JSON.parse(speed.body).listenerStageLatency));
    assert.ok(Array.isArray(JSON.parse(speed.body).firstResponseByCommand));

    const deniedWithoutToken = request("/metrics");
    assert.equal(deniedWithoutToken.status, 401);
    assert.equal(deniedWithoutToken.headers["Cache-Control"], "no-store");

    process.env.JT_PANEL__TOKEN = token;
    assert.equal(request("/metrics", "Bearer wrong-token").status, 401);

    const allowed = request("/metrics", "Bearer " + token);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["Cache-Control"], "no-store");
    assert.match(allowed.body, /"node"/);
  } finally {
    global.config = previousConfig;
    if (previousToken === undefined) delete process.env.JT_PANEL__TOKEN;
    else process.env.JT_PANEL__TOKEN = previousToken;
  }
});
