"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { parseArgs, request, runVerification } = require("../scripts/verify-deployment");

test("deployment verifier reads URL and token from environment without printing secrets", () => {
  const previousBase = process.env.JT_VERIFY_BASE_URL;
  const previousToken = process.env.JT_VERIFY_PANEL_TOKEN;
  try {
    process.env.JT_VERIFY_BASE_URL = "https://bot.example.test/";
    process.env.JT_VERIFY_PANEL_TOKEN = "private-panel-secret";
    const parsed = parseArgs(["node", "verify"]);
    assert.equal(parsed.base, "https://bot.example.test");
    assert.equal(parsed.token, "private-panel-secret");
    assert.throws(() => parseArgs(["node", "verify", "ftp://example.test"]), /HTTP hoặc HTTPS/);
  } finally {
    if (previousBase === undefined) delete process.env.JT_VERIFY_BASE_URL;
    else process.env.JT_VERIFY_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.JT_VERIFY_PANEL_TOKEN;
    else process.env.JT_VERIFY_PANEL_TOKEN = previousToken;
  }
});

test("deployment HTTP probe always uses GET and adds Bearer token only when supplied", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, authorization: req.headers.authorization || null });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const anonymous = await request(base, "/health");
    const authenticated = await request(base, "/api/recovery", { token: "panel-secret" });
    assert.equal(anonymous.status, 200);
    assert.equal(authenticated.status, 200);
    assert.deepEqual(requests, [
      { method: "GET", authorization: null },
      { method: "GET", authorization: "Bearer panel-secret" }
    ]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("anonymous deployment verification checks only liveness and authorization guards", async () => {
  const calls = [];
  const fetcher = async (_base, pathname, options = {}) => {
    calls.push({ pathname, token: options.token || null });
    if (pathname === "/health") {
      return { ok: true, status: 200, json: { status: "starting", uptimeMs: 1000, loggedIn: false }, ms: 1 };
    }
    return { ok: true, status: 401, json: { error: "Unauthorized" }, ms: 1 };
  };
  const output = [];
  const exitCode = await runVerification("https://example.test", null, fetcher, line => output.push(line));

  assert.equal(exitCode, 0);
  assert.equal(calls[0].pathname, "/health");
  assert.ok(calls.slice(1).every(call => call.token === null));
  assert.ok(calls.every(call => !call.pathname.endsWith("/send")));
  assert.ok(output.some(line => line.includes("Auth guard /api/recovery")));
  assert.ok(output.some(line => line.includes("authenticated") || line.includes("Đặt JT_VERIFY_PANEL_TOKEN")));
});

test("authenticated deployment verification inspects master, recovery, error and storage APIs read-only", async () => {
  const calls = [];
  const mockPayloads = {
    "/health": { status: "ok", uptimeMs: 5000, loggedIn: true },
    "/metrics": null,
    "/api/bots": { bots: [{ name: "main", loginState: "logged_in" }] },
    "/api/metrics": { node: "v22", uptimeMs: 5000 },
    "/api/recovery": {
      status: "healthy",
      master: { process: { memory: { rssBytes: 123 } } },
      bots: [{ name: "main", available: true }],
      alerts: []
    },
    "/api/errors": { summary: { errors: 0 }, events: [], bots: [] },
    "/api/database/health": { driver: "supabase", ok: true }
  };
  const fetcher = async (_base, pathname, options = {}) => {
    calls.push({ pathname, token: options.token, timeoutMs: options.timeoutMs });
    if (pathname === "/metrics") return { ok: true, status: 200, body: Buffer.from("# TYPE nodejs_heap_size_used_bytes gauge\n"), ms: 2 };
    return { ok: true, status: 200, json: mockPayloads[pathname], body: Buffer.alloc(0), ms: 2 };
  };
  const output = [];
  const exitCode = await runVerification("https://example.test", "panel-secret", fetcher, line => output.push(line));

  assert.equal(exitCode, 0);
  assert.ok(calls.some(call => call.pathname === "/api/recovery"));
  assert.ok(calls.some(call => call.pathname === "/api/errors"));
  assert.ok(calls.some(call => call.pathname === "/api/database/health"));
  assert.ok(calls.every(call => call.token === "panel-secret"));
  assert.ok(calls.every(call => !call.pathname.endsWith("/send")));
  assert.ok(output.some(line => line.includes("GET /api/recovery")));
  assert.ok(output.some(line => line.includes("GET /api/errors")));
});

test("production verifier has no message-send or state-changing route", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../scripts/verify-deployment"), "utf8");
  assert.doesNotMatch(source, /\/api\/chat\/.*\/send/);
  assert.doesNotMatch(source, /verify-deployment\] ping/);
  assert.match(source, /method: "GET"/);
  assert.doesNotMatch(source, /method: "POST"/);
});
