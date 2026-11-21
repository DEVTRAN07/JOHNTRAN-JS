"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../core/http/requestPolicy");

function makeFixtures() {
  const cases = [
    { env: {}, configured: {}, prefix: "JT_HTTP" },
    {
      env: {
        JT_HTTP_TIMEOUT_MS: "5000",
        JT_HTTP_RETRIES: "1",
        JT_HTTP_RETRY_DELAY_MS: "120"
      },
      configured: { timeoutMs: 3000, limit: 0, delayMs: 900 },
      prefix: "JT_HTTP"
    },
    {
      env: {},
      configured: { timeoutMs: 60000, limit: 3, delayMs: 5000 },
      prefix: "JT_HTTP"
    },
    {
      env: {
        JT_HTTP_TIMEOUT_MS: "not-a-number",
        JT_HTTP_RETRIES: "2",
        JT_HTTP_RETRY_DELAY_MS: "Infinity"
      },
      configured: { timeoutMs: 4200, limit: 1, delayMs: 80 },
      prefix: "JT_HTTP"
    },
    {
      env: {
        JT_HTTP_TIMEOUT_MS: null,
        JT_HTTP_RETRIES: false,
        JT_HTTP_RETRY_DELAY_MS: []
      },
      configured: { timeoutMs: "9000", limit: "1", delayMs: "700" },
      prefix: "JT_HTTP"
    },
    {
      env: {
        CUSTOM_TIMEOUT_MS: "15000",
        CUSTOM_RETRIES: "0",
        CUSTOM_RETRY_DELAY_MS: "1000"
      },
      configured: { timeoutMs: 1000, limit: 1, delayMs: 50 },
      prefix: "CUSTOM"
    },
    {
      env: {},
      configured: {
        timeoutMs: 1e30,
        limit: Number.MAX_SAFE_INTEGER + 1,
        delayMs: 12.5
      },
      prefix: "JT_HTTP"
    },
    {
      env: {
        JT_HTTP_TIMEOUT_MS: [12000],
        JT_HTTP_RETRIES: { valueOf: () => 1 },
        JT_HTTP_RETRY_DELAY_MS: { toString: () => "333" }
      },
      configured: { timeoutMs: [2000], limit: 0, delayMs: 250 },
      prefix: "JT_HTTP"
    }
  ];

  return {
    policies: cases.map(({ env, configured, prefix }) =>
      policy.resolveRequestPolicy(env, configured, prefix)
    ),
    bounded: [
      policy.boundedInteger("1200", 1000, 15000, 8000),
      policy.boundedInteger("60000", 1000, 15000, 8000),
      policy.boundedInteger("not-number", 1000, 15000, 8000),
      policy.boundedInteger(null, 0, 1, 7),
      policy.boundedInteger(false, 50, 1000, 250),
      policy.boundedInteger("2.5", 0.5, 2, 7),
      policy.boundedInteger(Number.MAX_SAFE_INTEGER + 1, 0, 10, 4)
    ]
  };
}

function observableRun(useRust) {
  const trace = [];
  const value = (name, result) => ({
    valueOf() {
      trace.push("number:" + name);
      return result;
    }
  });
  const config = {
    get timeoutMs() {
      trace.push("get:config.timeoutMs");
      return value("configured-timeout", 6000);
    },
    get limit() {
      trace.push("get:config.limit");
      return value("configured-retries", 1);
    },
    get delayMs() {
      trace.push("get:config.delayMs");
      return value("configured-delay", 300);
    }
  };
  const env = {
    get JT_HTTP_TIMEOUT_MS() {
      trace.push("get:env.timeout");
      return value("environment-timeout", 7000);
    },
    get JT_HTTP_RETRIES() {
      trace.push("get:env.retries");
      return value("environment-retries", 0);
    },
    get JT_HTTP_RETRY_DELAY_MS() {
      trace.push("get:env.delay");
      return value("environment-delay", 180);
    }
  };

  const previous = process.env.JT_RUST_HTTP_REQUEST_POLICY;
  try {
    if (useRust) delete process.env.JT_RUST_HTTP_REQUEST_POLICY;
    else process.env.JT_RUST_HTTP_REQUEST_POLICY = "0";
    const result = policy.resolveRequestPolicy(env, config);
    return { result, trace };
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_HTTP_REQUEST_POLICY;
    else process.env.JT_RUST_HTTP_REQUEST_POLICY = previous;
  }
}

test("HTTP request policy Rust addon exposes bounded integer and batch policy operations", t => {
  const diagnostics = policy.getNativeDiagnostics();
  if (!diagnostics.loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  assert.equal(diagnostics.active, true, diagnostics.lastError || diagnostics.loadError || "HTTP request policy Rust functions are inactive");
  assert.ok(diagnostics.exports.includes("requestBoundedInteger"));
  assert.ok(diagnostics.exports.includes("resolveHttpRequestPolicy"));
});

test("HTTP request policy Rust results match JavaScript for environment and config edge cases", t => {
  if (!policy.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const previous = process.env.JT_RUST_HTTP_REQUEST_POLICY;
  try {
    process.env.JT_RUST_HTTP_REQUEST_POLICY = "0";
    const fallback = makeFixtures();
    delete process.env.JT_RUST_HTTP_REQUEST_POLICY;
    const rust = makeFixtures();
    assert.deepEqual(rust, fallback);
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_HTTP_REQUEST_POLICY;
    else process.env.JT_RUST_HTTP_REQUEST_POLICY = previous;
  }
});

test("HTTP policy keeps legacy getter and Number coercion evaluation order", t => {
  if (!policy.getNativeDiagnostics().loaded) {
    t.skip("native domain-core addon is not built in this environment");
    return;
  }
  const fallback = observableRun(false);
  const rust = observableRun(true);
  assert.deepEqual(rust, fallback);
});

test("boundedInteger preserves native JavaScript Number coercion errors", () => {
  assert.throws(() => policy.boundedInteger(Symbol("timeout"), 0, 10, 5), TypeError);
});
