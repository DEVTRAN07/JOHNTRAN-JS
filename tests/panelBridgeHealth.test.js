"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createBridgeHealthProbe } = require("../panel/bridgeHealth");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("bridge health probe confirms a live authenticated child and caches short reads", async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    assert.equal(req.url, "/health");
    assert.equal(req.headers["x-bridge-token"], "bridge-secret");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, loggedIn: true, pid: 1234, bot: "main" }));
  });
  const port = await listen(server);
  const probe = createBridgeHealthProbe({ timeoutMs: 400, positiveCacheMs: 3000 });

  try {
    const bot = { name: "main", bridgePort: port };
    const [first, second] = await Promise.all([
      probe.probe(bot, "bridge-secret"),
      probe.probe(bot, "bridge-secret")
    ]);
    assert.equal(first.loggedIn, true);
    assert.equal(first.pid, 1234);
    assert.equal(second.loggedIn, true);
    assert.equal(requests, 1, "parallel refreshes should share one local health request");

    const cached = await probe.probe(bot, "bridge-secret");
    assert.equal(cached.reachable, true);
    assert.equal(requests, 1, "short-lived cache should avoid repeated local requests");
  } finally {
    probe.clear("main");
    await new Promise(resolve => server.close(resolve));
  }
});

test("bridge health probe does not treat an unauthenticated child as logged in", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, loggedIn: false, pid: 1234 }));
  });
  const port = await listen(server);
  const probe = createBridgeHealthProbe({ timeoutMs: 400, positiveCacheMs: 0 });

  try {
    const health = await probe.probe({ name: "waiting", bridgePort: port }, "bridge-secret");
    assert.equal(health.reachable, true);
    assert.equal(health.loggedIn, false);
  } finally {
    probe.clear("waiting");
    await new Promise(resolve => server.close(resolve));
  }
});
