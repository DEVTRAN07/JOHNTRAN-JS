"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { request } = require("../vendor/zalo-client/dist/cjs/core/http.cjs");

function makeContext({ cookieGetter, polyfill, onRequestTiming, timeoutMs = 40 } = {}) {
  return {
    cookie: {
      getCookieString: cookieGetter || (async () => "zalo-session=test"),
      setCookie: async () => undefined
    },
    userAgent: "JOHNTRAN test",
    options: {
      retry: { timeoutMs, limit: 0, methods: ["GET", "HEAD"], delayMs: 1, maxDelayMs: 1 },
      polyfill: polyfill || (async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null }
      })),
      onRequestTiming
    }
  };
}

test("Zalo SDK timeout also covers asynchronous cookie/header preparation", async () => {
  const ctx = makeContext({
    timeoutMs: 35,
    cookieGetter: () => new Promise(() => {})
  });
  const startedAt = Date.now();

  await assert.rejects(
    request(ctx, "https://chat.zalo.me/api/test", { method: "POST" }),
    error => error?.code === "ETIMEDOUT" && error?.name === "TimeoutError"
  );

  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 500, `cookie header stall escaped the SDK deadline: ${elapsed}ms`);
});

test("Zalo SDK reports cookie, fetch, response-cookie and total request phases", async () => {
  const phases = new Map();
  const ctx = makeContext({
    timeoutMs: 200,
    onRequestTiming: (phase, elapsedMs) => phases.set(phase, elapsedMs)
  });

  await request(ctx, "https://chat.zalo.me/api/test", { method: "POST" });

  for (const phase of ["cookie-headers", "fetch", "response-cookies", "total"]) {
    assert.ok(phases.has(phase), `missing timing phase: ${phase}`);
    assert.ok(phases.get(phase) >= 0);
  }
});

test("Zalo SDK timing callback failures never break a request", async () => {
  const ctx = makeContext({
    onRequestTiming: () => { throw new Error("diagnostics failure"); }
  });
  const response = await request(ctx, "https://chat.zalo.me/api/test", { method: "POST" });
  assert.equal(response.status, 200);
});
