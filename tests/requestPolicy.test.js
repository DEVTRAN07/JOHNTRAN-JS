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


test("Zalo retry policy maps retries to the vendored SDK actual limit option", () => {
  const { resolveZaloRetryPolicy, createZaloClient } = require("../core/login");
  const policy = resolveZaloRetryPolicy({}, {});
  assert.equal(policy.timeoutMs, 8000);
  assert.equal(policy.retries, 0);
  assert.equal(policy.limit, 0);
  assert.deepEqual(policy.methods, ["GET", "HEAD"]);

  // Regression guard: the actual SDK constructor must receive the key it reads.
  const client = createZaloClient();
  assert.equal(client.options.retry.timeoutMs, 8000);
  assert.equal(client.options.retry.limit, 0);
  assert.equal(client.options.retry.retries, 0);
});


test("vendored Zalo SDK sends only one GET attempt when the mapped retry limit is zero", async () => {
  const { request } = require("../vendor/zalo-client/dist/cjs/core/http.cjs");
  const { resolveZaloRetryPolicy } = require("../core/login");
  const calls = [];
  const ctx = {
    cookie: { getCookieString: async () => "" },
    userAgent: "JOHNTRAN test",
    options: {
      retry: resolveZaloRetryPolicy({}, {}),
      polyfill: async () => {
        calls.push("attempt");
        throw new Error("simulated network failure");
      }
    }
  };

  await assert.rejects(
    request(ctx, "https://chat.zalo.me/api/test", { method: "GET" }),
    /simulated network failure/
  );
  assert.equal(calls.length, 1,
    "the vendored SDK must not keep its default three retries when policy says zero");
});
