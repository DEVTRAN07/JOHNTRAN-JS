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


test("metrics separate first response processing latency from Zalo send RTT", () => {
  const backend = createFakeDb();
  const metrics = createMetricsStore(backend, { flushDelayMs: 60000 });

  metrics.trackFirstResponseLatency("menu", 100);
  metrics.trackFirstResponseLatency("menu", 180);
  metrics.trackZaloSendLatency(35, true);
  metrics.trackZaloSendLatency(75, false);

  const first = metrics.getFirstResponseLatencyStats(5)[0];
  const send = metrics.getZaloSendLatencyStats();
  assert.equal(first.command, "menu");
  assert.equal(first.count, 2);
  assert.equal(first.p95Ms, 180);
  assert.equal(send.count, 2);
  assert.equal(send.success, 1);
  assert.equal(send.failed, 1);
  assert.equal(send.avgMs, 55);
  assert.equal(backend.writes.length, 0);
  metrics.dispose();
});
