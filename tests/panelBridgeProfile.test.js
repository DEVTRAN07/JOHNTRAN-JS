"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createBridgeProfileProbe } = require("../panel/bridgeProfile");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

test("bridge profile probe reads the live Zalo identity and caches it briefly", async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    assert.equal(req.url, "/profile");
    assert.equal(req.headers["x-bridge-token"], "bridge-secret");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ profile: {
      uid: "zalo-uid-123", displayName: "JOHNTRAN Zalo", avatar: "https://example.com/avatar.png"
    } }));
  });
  const port = await listen(server);
  const probe = createBridgeProfileProbe({ timeoutMs: 400, positiveCacheMs: 3000 });

  try {
    const bot = { name: "main", bridgePort: port };
    const [first, second] = await Promise.all([
      probe.probe(bot, "bridge-secret"),
      probe.probe(bot, "bridge-secret")
    ]);
    assert.equal(first.displayName, "JOHNTRAN Zalo");
    assert.equal(first.avatar, "https://example.com/avatar.png");
    assert.equal(first.uid, "zalo-uid-123");
    assert.deepEqual(second, first);
    assert.equal(requests, 1, "parallel reads should share one profile request");

    const cached = await probe.probe(bot, "bridge-secret");
    assert.deepEqual(cached, first);
    assert.equal(requests, 1, "positive cache should avoid another child request");
  } finally {
    probe.clear("main");
    await new Promise(resolve => server.close(resolve));
  }
});

test("bridge profile probe fails safely for invalid ports and missing profile payloads", async () => {
  const probe = createBridgeProfileProbe({ timeoutMs: 400, positiveCacheMs: 0 });
  assert.equal(await probe.probe({ name: "invalid", bridgePort: 0 }, "token"), null);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ profile: null }));
  });
  const port = await listen(server);
  try {
    assert.equal(await probe.probe({ name: "empty", bridgePort: port }, "token"), null);
  } finally {
    probe.clear("empty");
    await new Promise(resolve => server.close(resolve));
  }
});
