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

  for (const phase of ["cookie-headers", "fetch", "response-cookies", "response-body", "total"]) {
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


test("Zalo SDK deadline covers a response body that stalls after fetch returns headers", async () => {
  let capturedSignal = null;
  let streamCancelled = false;
  const stalledBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error_code":0,'));
    },
    cancel() {
      streamCancelled = true;
    }
  });
  const ctx = makeContext({
    timeoutMs: 35,
    polyfill: async (_url, options) => {
      capturedSignal = options.signal;
      return new Response(stalledBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const startedAt = Date.now();

  await assert.rejects(
    request(ctx, "https://chat.zalo.me/api/stalled-body", { method: "POST" }),
    error => error?.code === "ETIMEDOUT" && error?.name === "TimeoutError"
  );

  assert.ok(Date.now() - startedAt < 500, "response body escaped the SDK deadline");
  assert.equal(capturedSignal?.aborted, true);
  assert.equal(streamCancelled, true);
});

test("Zalo SDK returns a readable buffered response after timing its complete body", async () => {
  const phases = new Map();
  const ctx = makeContext({
    onRequestTiming: (phase, elapsedMs) => phases.set(phase, elapsedMs),
    polyfill: async () => new Response(JSON.stringify({ error_code: 0, data: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const response = await request(ctx, "https://chat.zalo.me/api/body", { method: "POST" });

  assert.deepEqual(await response.json(), { error_code: 0, data: { ok: true } });
  assert.ok(phases.get("response-body") >= 0);
  assert.ok(phases.get("total") >= phases.get("response-body"));
});

test("Zalo SDK caps manual redirect chains", async () => {
  let requests = 0;
  const ctx = makeContext({
    timeoutMs: 200,
    polyfill: async url => {
      requests++;
      return new Response(null, {
        status: 302,
        headers: { location: String(url) + "?again=" + requests }
      });
    }
  });
  await assert.rejects(
    request(ctx, "https://chat.zalo.me/api/redirect", { method: "POST" }),
    error => error?.code === "ETOOMANYREDIRECTS"
  );
  assert.equal(requests, 6);
});
