"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/speed");

test("/speed is admin-only and does not require user-data preload", () => {
  assert.equal(command.config.role, 2);
  assert.equal(command.config.requiresUserData, false);
  assert.equal(command.config.cooldowns, 3);
});

test("/speed reports end-to-end, handler, listener, API and first-response timings", () => {
  const fakeMetrics = {
    getLatencyStats: () => ({
      count: 9, avgMs: 320, p50Ms: 210, p95Ms: 820, maxMs: 900, lastMs: 150
    }),
    getCommandLatencyStats: () => [{ command: "stk", avgMs: 700, p95Ms: 820, count: 3 }],
    getCommandExecutionLatencyStats: () => [{ command: "stk", avgMs: 22, p95Ms: 40, count: 3 }],
    getListenerStageLatencyStats: () => [{ command: "thread-data", avgMs: 3, p95Ms: 5, count: 9 }],
    getZaloApiLatencyStats: () => [{ command: "sendMessage", avgMs: 650, p95Ms: 780, count: 9 }],
    getFirstResponseLatencyByCommandStats: () => [{ command: "stk", avgMs: 760, p95Ms: 850, count: 3 }]
  };

  const report = command._test.buildSpeedReport(fakeMetrics, 125, { p95Ms: 13, p99Ms: 20, maxMs: 22 });

  assert.match(report, /TOÀN BỘ PIPELINE LỆNH/);
  assert.match(report, /P95 820\.0 ms/);
  assert.match(report, /HANDLER/);
  assert.match(report, /thread-data/);
  assert.match(report, /sendMessage/);
  assert.match(report, /PHẢN HỒI ĐẦU TIÊN/);
  assert.match(report, /P95 850\.0 ms/);
});

test("/speed handles an empty metrics store", () => {
  const emptyMetrics = {
    getLatencyStats: () => ({ count: 0 }),
    getCommandLatencyStats: () => [],
    getCommandExecutionLatencyStats: () => [],
    getListenerStageLatencyStats: () => [],
    getZaloApiLatencyStats: () => [],
    getFirstResponseLatencyByCommandStats: () => []
  };
  const report = command._test.buildSpeedReport(emptyMetrics, 0, null);
  assert.match(report, /Chưa có mẫu lệnh/);
  assert.equal((report.match(/Chưa có dữ liệu/g) || []).length, 6);
});
