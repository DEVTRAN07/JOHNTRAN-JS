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

test("/speed reports JSON writer state without exposing file paths", () => {
  const rows = command._test.formatStorageDiagnostics({
    driver: "json",
    ok: true,
    pendingFlush: true,
    writer: { enabled: true, ready: true, sequence: 42, persistedSequence: 39 },
    lastFlushAt: 1000
  }, 2000).join("|");

  assert.match(rows, /Driver: JSON/);
  assert.match(rows, /background worker hoạt động/);
  assert.match(rows, /Pending flush: có/);
  assert.ok(rows.includes("39/42 đã ghi"));
  assert.doesNotMatch(rows, /filePath|store\\.json|serviceKey/);
});

test("/speed reports Supabase retry pressure without credentials", () => {
  const rows = command._test.formatStorageDiagnostics({
    driver: "supabase",
    syncEnabled: true,
    consecutiveFailures: 2,
    pendingWrites: 5,
    retryQueueSize: 3,
    lastSyncAgeMs: 1200,
    serviceKey: "must-not-leak"
  }).join("|");

  assert.match(rows, /Driver: SUPABASE/);
  assert.match(rows, /Pending writes: 5 · retry queue: 3/);
  assert.match(rows, /lỗi liên tiếp 2/);
  assert.doesNotMatch(rows, /must-not-leak|serviceKey|SUPABASE_SECRET_KEY/);
});

test("/speed shows Rust message-cache IPC pressure without local file paths", () => {
  const rows = command._test.formatMessageCacheDiagnostics({
    entries: 1200,
    asyncFlushCount: 8,
    asyncFlushFailures: 1,
    asyncFlushLastMs: 17,
    nativePersistence: { available: true, binary: "/private/path/jt-message-cache" },
    nativePendingMutations: { pending: 9, sent: 1200, failed: 1, batchSize: 64 }
  }).join("|");

  assert.match(rows, /Bản ghi đang giữ: 1200/);
  assert.match(rows, /Rust sidecar: đang hoạt động/);
  assert.match(rows, /IPC queue: chờ 9 · đã gửi 1200 · lỗi 1 · batch 64/);
  assert.match(rows, /Flush: 8 · lỗi 1 · lần gần nhất 17\.0 ms/);
  assert.doesNotMatch(rows, /private|jt-message-cache/);
});

test("/speed distinguishes Zalo delivery delay from bot processing latency", () => {
  const report = command._test.buildSpeedReport({
    getLatencyStats: () => ({ count: 1, avgMs: 120, p50Ms: 120, p95Ms: 120, maxMs: 120, lastMs: 120 }),
    getCommandLatencyStats: () => [],
    getCommandExecutionLatencyStats: () => [],
    getListenerStageLatencyStats: () => [],
    getZaloApiLatencyStats: () => [],
    getFirstResponseLatencyByCommandStats: () => [],
    getMessageDeliveryAgeStats: () => ({
      command: "zalo-server-to-bot", count: 4, avgMs: 18000, p95Ms: 45000, maxMs: 70000
    })
  });
  assert.match(report, /ĐỘ TRỄ TRƯỚC KHI BOT NHẬN TIN/);
  assert.match(report, /Zalo tạo tin → bot nhận: P95 45000\.0 ms/);
  assert.match(report, /Max 70000\.0 ms/);
});

test("/speed shows the active bounded Zalo and external HTTP timeout policy", () => {
  const lines = command._test.formatRequestPolicy({
    zalo: { timeoutMs: 8000, retries: 0 },
    external: { timeoutMs: 8000, retries: 1 }
  }).join("|");
  assert.match(lines, /Zalo API: timeout 8000 ms · retry 0/);
  assert.match(lines, /HTTP ngoài: timeout 8000 ms · retry 1/);
  assert.match(lines, /POST không tự gửi lại/);
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
