"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRequestPolicy } = require("../core/http/requestPolicy");
const { normalizeRequestOptions } = require("../core/http");

test("shared external HTTP policy defaults to an eight-second timeout and no retries", () => {
  const policy = resolveRequestPolicy({}, {}, "JT_HTTP");
  assert.deepEqual(policy, {
    timeoutMs: 8000,
    retries: 0,
    delayMs: 250,
    maxDelayMs: 500,
    methods: ["GET", "HEAD"]
  });
});

test("shared HTTP policy clamps old long timeout and retry settings", () => {
  const policy = resolveRequestPolicy({}, { timeoutMs: 60000, limit: 3 }, "JT_HTTP");
  assert.equal(policy.timeoutMs, 15000);
  assert.equal(policy.retries, 1);
});

test("environment can set a finite bounded timeout and optional single retry", () => {
  const policy = resolveRequestPolicy({
    JT_HTTP_TIMEOUT_MS: "5000",
    JT_HTTP_RETRIES: "1",
    JT_HTTP_RETRY_DELAY_MS: "120"
  });
  assert.equal(policy.timeoutMs, 5000);
  assert.equal(policy.retries, 1);
  assert.equal(policy.delayMs, 120);
});

test("core HTTP requests clamp per-command timeout and retries to shared policy", () => {
  assert.deepEqual(normalizeRequestOptions({
    method: "GET",
    timeout: 60000,
    retries: 3,
    userAgent: "test"
  }), {
    method: "GET",
    timeout: 8000,
    retries: 0,
    userAgent: "test"
  });
});
