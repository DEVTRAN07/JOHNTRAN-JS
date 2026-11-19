"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMetricsStore } = require("../core/metrics");

function createFakeDb() {
  const records = new Map();
  const writes = [];
  return {
    writes,
    get(_table, _idField, id) {
      return records.get(String(id)) || null;
    },
    set(_table, idField, id, data) {
      writes.push({ id: String(id), data: structuredClone(data) });
      const key = String(id);
      const record = { [idField]: key, data };
      records.set(key, record);
      return record;
    },
    all() {
      return [...records.values()];
    }
  };
}

test("metrics increments stay in memory until the batch flush", () => {
  const backend = createFakeDb();
  const fixedNow = Date.parse("2026-11-12T04:00:00.000Z");
  const metrics = createMetricsStore(backend, {
    flushDelayMs: 60000,
    now: () => fixedNow
  });

  metrics.track("command", { command: "menu" });
  metrics.track("command", { command: "menu" });
  metrics.track("error");

  assert.equal(backend.writes.length, 0);
  assert.equal(metrics.getDayStats().commands, 2);
  assert.equal(metrics.getDayStats().errors, 1);
  assert.deepEqual(metrics.topCommands(), [["menu", 2]]);

  assert.equal(metrics.flush(), 1);
  assert.equal(backend.writes.length, 1);
  assert.equal(backend.writes[0].data.commands, 2);
  assert.equal(backend.writes[0].data.errors, 1);
  assert.deepEqual(backend.writes[0].data.byCommand, { menu: 2 });

  assert.equal(metrics.flush(), 0);
  metrics.dispose();
});

test("metrics preserve existing daily counters loaded from storage", () => {
  const backend = createFakeDb();
  backend.set("Metrics", "day", "2026-11-12", {
    day: "2026-11-12",
    commands: 9,
    errors: 1,
    musicSearch: 0,
    musicDownload: 0,
    aiRequests: 0,
    ttsRequests: 0,
    byCommand: { help: 9 }
  });
  backend.writes.length = 0;

  const metrics = createMetricsStore(backend, {
    flushDelayMs: 60000,
    now: () => Date.parse("2026-11-12T04:00:00.000Z")
  });
  metrics.track("command", { command: "menu" });
  assert.equal(metrics.getDayStats().commands, 10);
  assert.deepEqual(metrics.topCommands(), [["help", 9], ["menu", 1]]);
  metrics.flush();
  assert.equal(backend.writes.length, 1);
  metrics.dispose();
});

test("command pipeline latency reports recent percentiles without storing samples in the database", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });

  metrics.trackLatency(10);
  metrics.trackLatency(20);
  metrics.trackLatency(30);
  metrics.trackLatency(Number.NaN);

  assert.deepEqual(metrics.getLatencyStats(), {
    count: 3,
    avgMs: 20,
    p50Ms: 20,
    p95Ms: 30,
    maxMs: 30,
    lastMs: 30
  });
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});


test("metrics keep end-to-end and handler-only command latency separate", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });

  metrics.trackCommandLatency("menu", 240);
  metrics.trackCommandLatency("menu", 310);
  metrics.trackCommandExecutionLatency("menu", 55);
  metrics.trackCommandExecutionLatency("menu", 80);

  const pipeline = metrics.getCommandLatencyStats(5)[0];
  const handler = metrics.getCommandExecutionLatencyStats(5)[0];
  assert.equal(pipeline.command, "menu");
  assert.equal(pipeline.p95Ms, 310);
  assert.equal(handler.command, "menu");
  assert.equal(handler.p95Ms, 80);
  assert.notEqual(pipeline.p95Ms, handler.p95Ms);
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});

test("first response latency is recorded both in aggregate and per command", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });
  const menuEvent = { threadId: "g-1", data: { cliMsgId: "menu-1" } };
  const stkEvent = { threadId: "g-1", data: { cliMsgId: "stk-1" } };

  metrics.trackIncomingMessage(menuEvent, 100);
  metrics.trackFirstResponseLatency(menuEvent, 260, "menu");
  metrics.trackIncomingMessage(stkEvent, 500);
  metrics.trackFirstResponseLatency(stkEvent, 1800, "stk");

  assert.equal(metrics.getFirstResponseLatencyStats().p95Ms, 1300);
  assert.deepEqual(
    metrics.getFirstResponseLatencyByCommandStats(5).map(item => [item.command, item.p95Ms]),
    [["stk", 1300], ["menu", 160]]
  );
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});

test("metrics use Asia/Ho_Chi_Minh day boundary rather than UTC midnight", () => {
  const metricsModule = require("../core/metrics");
  assert.equal(metricsModule.todayKey(Date.parse("2026-11-12T16:59:59.999Z")), "2026-11-12");
  assert.equal(metricsModule.todayKey(Date.parse("2026-11-12T17:00:00.000Z")), "2026-11-13");
});

test("metrics expose bounded latency summaries per command", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });
  metrics.trackCommandLatency("menu", 20);
  metrics.trackCommandLatency("menu", 40);
  metrics.trackCommandLatency("status", 80);
  assert.deepEqual(metrics.getCommandLatencyStats(2).map(item => item.command), ["status", "menu"]);
  assert.equal(metrics.getCommandLatencyStats(2)[1].avgMs, 30);
  metrics.dispose();
});

test("metrics isolate listener stages, first response and Zalo API latency", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });
  const event = { threadId: "group-1", data: { cliMsgId: "message-1", msgId: "server-1" } };

  assert.equal(metrics.trackIncomingMessage(event, 100), true);
  assert.equal(metrics.trackFirstResponseLatency(event, 245), true);
  assert.equal(metrics.trackFirstResponseLatency(event, 300), false);
  metrics.trackListenerStageLatency("thread-data", 15);
  metrics.trackListenerStageLatency("receive-to-command", 24);
  metrics.trackZaloApiLatency("sendMessage", 80);
  metrics.trackZaloApiLatency("addReaction", 120);

  const firstResponse = metrics.getFirstResponseLatencyStats();
  assert.equal(firstResponse.count, 1);
  assert.equal(firstResponse.p50Ms, 145);
  assert.equal(metrics.getListenerStageLatencyStats(5).length, 2);
  assert.deepEqual(metrics.getZaloApiLatencyStats(5).map(item => item.command), ["addreaction", "sendmessage"]);
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});


test("metrics measure Zalo server-to-listener message age separately from bot first response", () => {
  const backend = createFakeDb();
  const fixedNow = Date.parse("2026-11-19T12:00:00.000Z");
  const metrics = createMetricsStore(backend, {
    flushDelayMs: 60000,
    now: () => fixedNow
  });
  const event = {
    threadId: "group-age",
    data: { cliMsgId: "age-1", ts: String(fixedNow - 12500) }
  };

  assert.equal(metrics.trackIncomingMessage(event, 100), true);
  metrics.trackFirstResponseLatency(event, 220, "menu");

  const deliveryAge = metrics.getMessageDeliveryAgeStats();
  assert.equal(deliveryAge.command, "zalo-server-to-bot");
  assert.equal(deliveryAge.count, 1);
  assert.equal(deliveryAge.p95Ms, 12500);
  assert.equal(metrics.getFirstResponseLatencyStats().p95Ms, 120);
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});

test("metrics normalize Zalo seconds, milliseconds, microseconds and nanoseconds", () => {
  const { normalizeZaloMessageTimestamp } = require("../core/metrics");
  const milliseconds = Date.parse("2026-11-19T12:00:00.000Z");
  assert.equal(normalizeZaloMessageTimestamp(milliseconds / 1000), milliseconds);
  assert.equal(normalizeZaloMessageTimestamp(milliseconds), milliseconds);
  assert.equal(normalizeZaloMessageTimestamp(milliseconds * 1000), milliseconds);
  assert.equal(normalizeZaloMessageTimestamp(milliseconds * 1e6), milliseconds);
  assert.equal(normalizeZaloMessageTimestamp("invalid"), null);
});
