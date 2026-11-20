"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  resolveTransportOptions,
  createFetchMetrics,
  readRequestHost,
  isPriorityReplyRequest,
  installZaloHttpTransport,
  closeZaloHttpTransport
} = require("../core/http/transport");

test("HTTP transport keeps connections warm longer than Undici's default idle timeout", () => {
  const options = resolveTransportOptions({}, {});
  assert.equal(options.connections, 8);
  assert.equal(options.replyConnections, 4);
  assert.equal(options.keepAliveTimeout, 60_000);
  assert.equal(options.keepAliveMaxTimeout, 120_000);
  assert.equal(options.connect.timeout, 10_000);
  assert.equal(options.pipelining, 1);
});

test("HTTP transport options accept bounded environment overrides", () => {
  const options = resolveTransportOptions({
    JT_ZALO_HTTP_CONNECTIONS: "4",
    JT_ZALO_HTTP_KEEPALIVE_MS: "45000",
    JT_ZALO_HTTP_KEEPALIVE_MAX_MS: "90000",
    JT_ZALO_HTTP_CONNECT_TIMEOUT_MS: "7000",
    JT_ZALO_HTTP_REPLY_CONNECTIONS: "6"
  });
  assert.equal(options.connections, 4);
  assert.equal(options.replyConnections, 6);
  assert.equal(options.keepAliveTimeout, 45_000);
  assert.equal(options.keepAliveMaxTimeout, 90_000);
  assert.equal(options.connect.timeout, 7_000);
});

test("HTTP fetch metrics keep bounded per-host latency and error samples", () => {
  const metrics = createFetchMetrics({ maxHosts: 2, maxSamples: 10 });
  metrics.record("chat.zalo.me", 40, 200, false);
  metrics.record("chat.zalo.me", 120, 200, false);
  metrics.record("chat.zalo.me", 230, 502, false);
  metrics.record("chat.zalo.me", 300, 0, true);

  const snapshot = metrics.stats(5);
  assert.equal(snapshot.count, 4);
  assert.equal(snapshot.failed, 2);
  assert.equal(snapshot.byHost[0].host, "chat.zalo.me");
  assert.equal(snapshot.byHost[0].count, 4);
  assert.equal(snapshot.byHost[0].failed, 2);
  assert.equal(snapshot.byHost[0].p95Ms, 300);
  assert.equal(snapshot.byHost[0].statuses["200"], 2);
  assert.equal(snapshot.byHost[0].statuses["502"], 1);
  assert.equal(snapshot.byHost[0].statuses.network_error, 1);
});

test("HTTP host extraction never includes request paths or query strings", () => {
  assert.equal(readRequestHost("https://chat.zalo.me/api/group/sendmsg?token=hidden"), "chat.zalo.me");
  assert.equal(readRequestHost(new Request("https://group.zalo.me/api/group")), "group.zalo.me");
  assert.equal(readRequestHost("not-a-url"), "unknown");
});

test("plain-text Zalo sends use a separate priority connection pool", () => {
  assert.equal(
    isPriorityReplyRequest("https://group.zalo.me/api/group/sendmsg", { method: "POST" }),
    true
  );
  assert.equal(
    isPriorityReplyRequest("https://chat.zalo.me/api/message/sms?zpw_ver=1", { method: "POST" }),
    true
  );
  assert.equal(
    isPriorityReplyRequest("https://group.zalo.me/api/group/getGroupInfo", { method: "POST" }),
    false
  );
  assert.equal(
    isPriorityReplyRequest("https://group.zalo.me/api/group/sendmsg", { method: "GET" }),
    false
  );
});

test("installed global fetch uses the pooled dispatcher and records response timings", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/health?token=must-not-be-recorded`;

  try {
    const installed = installZaloHttpTransport({
      connections: 2,
      keepAliveTimeoutMs: 2_000,
      keepAliveMaxTimeoutMs: 4_000,
      connectTimeoutMs: 3_000
    });
    assert.equal(installed.installed, true);

    const first = await fetch(url);
    const second = await fetch(
      `http://127.0.0.1:${address.port}/api/group/sendmsg`,
      { method: "POST", body: "message" }
    );
    assert.equal(await first.text(), "ok");
    assert.equal(await second.text(), "ok");

    const snapshot = require("../core/http/transport").getZaloHttpTransportStats();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.count, 2);
    assert.equal(snapshot.lanes.shared.count, 1);
    assert.equal(snapshot.lanes.reply.count, 1);
    assert.equal(snapshot.options.replyConnections, 4);
    assert.equal(snapshot.byHost[0].host, "127.0.0.1");
    assert.equal(snapshot.byHost[0].count, 2);
  } finally {
    await closeZaloHttpTransport();
    await new Promise(resolve => server.close(resolve));
  }
});
