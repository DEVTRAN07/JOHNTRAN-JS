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

test("/speed reports HTTP fetch timing separately from complete Zalo API timing", () => {
  const emptyMetrics = {
    getLatencyStats: () => ({ count: 0 }),
    getCommandLatencyStats: () => [],
    getCommandExecutionLatencyStats: () => [],
    getListenerStageLatencyStats: () => [],
    getZaloApiLatencyStats: () => [],
    getFirstResponseLatencyByCommandStats: () => []
  };
  const transport = {
    count: 12,
    failed: 1,
    byHost: [{ host: "chat.zalo.me", count: 12, failed: 1, avgMs: 95, p95Ms: 160 }]
  };
  const report = command._test.buildSpeedReport(emptyMetrics, 0, null, transport);
  assert.match(report, /HTTP FETCH \/ KẾT NỐI/);
  assert.match(report, /chat\.zalo\.me/);
  assert.match(report, /P95 160\.0 ms/);
  assert.match(report, /lỗi 1/);
});

test("/speed shows queue wait and worker saturation separately from API latency", () => {
  const emptyMetrics = {
    getLatencyStats: () => ({ count: 0 }),
    getCommandLatencyStats: () => [],
    getCommandExecutionLatencyStats: () => [],
    getListenerStageLatencyStats: () => [],
    getZaloApiLatencyStats: () => [],
    getFirstResponseLatencyByCommandStats: () => []
  };
  const jobQueues = {
    global: { active: 4, pending: 7, concurrency: 4 },
    canvas: { active: 1, pending: 3, avgWaitMs: 240, maxWaitMs: 510, waitCount: 12 },
    http: { active: 1, pending: 0, avgWaitMs: 5, maxWaitMs: 12, waitCount: 8 }
  };
  const workers = {
    canvas: { workers: 2, busy: 2, pending: 4, rejected: 1 }
  };
  const report = command._test.buildSpeedReport(emptyMetrics, 20, null, null, jobQueues, workers);
  assert.match(report, /HÀNG ĐỢI \/ WORKER/);
  assert.match(report, /Global: 4\/4 slot · chờ 7/);
  assert.match(report, /canvas: active 1 · pending 3 · wait TB 240\.0 ms · max 510\.0 ms/);
  assert.match(report, /Worker canvas: busy 2\/2 · pending 4 · reject 1/);
});

test("/speed reports effective CPU, FFmpeg and media concurrency limits", () => {
  const report = command._test.buildSpeedReport(
    {
      getLatencyStats: () => ({ count: 0 }),
      getCommandLatencyStats: () => [],
      getCommandExecutionLatencyStats: () => [],
      getListenerStageLatencyStats: () => [],
      getZaloApiLatencyStats: () => [],
      getFirstResponseLatencyByCommandStats: () => []
    },
    10,
    null,
    null,
    {},
    {},
    {
      availableCpus: 2,
      ffmpegThreads: 1,
      workerPoolMaxSize: 1,
      globalJobConcurrency: 1,
      defaultGlobalJobConcurrency: 1,
      stickerConcurrency: 1,
      downloadConcurrency: 1
    }
  );

  assert.match(report, /GIỚI HẠN TÀI NGUYÊN MEDIA/);
  assert.match(report, /CPU khả dụng: 2 lõi/);
  assert.match(report, /FFmpeg: 1 thread\/lượt/);
  assert.match(report, /Worker pool: tối đa 1 worker\/pool/);
  assert.match(report, /Global media queue: 1 job \(mặc định CPU: 1\)/);
  assert.match(report, /STK: 1 job đồng thời/);
  assert.match(report, /Tải media: 1 job đồng thời/);
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
  assert.equal((report.match(/Chưa có dữ liệu/g) || []).length, 5);
});
