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
    getZaloSdkPhaseLatencyStats: () => [{ command: "cookie-headers", avgMs: 1.4, p95Ms: 3, count: 9 }],
    getFirstResponseLatencyByCommandStats: () => [{ command: "stk", avgMs: 760, p95Ms: 850, count: 3 }]
  };

  const report = command._test.buildSpeedReport(fakeMetrics, 125, { p95Ms: 13, p99Ms: 20, maxMs: 22 });

  assert.match(report, /TOÀN BỘ PIPELINE LỆNH/);
  assert.match(report, /P95 820\.0 ms/);
  assert.match(report, /HANDLER/);
  assert.match(report, /thread-data/);
  assert.match(report, /sendMessage/);
  assert.match(report, /CÁC PHA BÊN TRONG ZALO-CLIENT/);
  assert.match(report, /cookie-headers/);
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
    zalo: { timeoutMs: 8000, retries: 0, limit: 0 },
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
  assert.equal((report.match(/Chưa có dữ liệu/g) || []).length, 6);
});


test("/speed keeps the response within a conservative Zalo text budget", () => {
  const manyRows = Array.from({ length: 30 }, (_, index) => ({
    command: "command-" + index, avgMs: 1200 + index, p95Ms: 2500 + index, count: 40
  }));
  const report = command._test.buildSpeedReport({
    getLatencyStats: () => ({ count: 40, avgMs: 1300, p50Ms: 1000, p95Ms: 2500, maxMs: 9000, lastMs: 120 }),
    getCommandLatencyStats: () => manyRows,
    getCommandExecutionLatencyStats: () => manyRows,
    getListenerStageLatencyStats: () => manyRows,
    getZaloApiLatencyStats: () => manyRows,
    getZaloSdkPhaseLatencyStats: () => manyRows,
    getFirstResponseLatencyByCommandStats: () => manyRows,
    getMessageDeliveryAgeStats: () => ({ count: 40, avgMs: 1200, p95Ms: 2500, maxMs: 9000 })
  }, 1000, { p95Ms: 500, p99Ms: 900, maxMs: 1200 }, {
    enabled: true,
    byHost: manyRows.map((row, index) => ({ ...row, host: "host-" + index + ".zalo.me", failed: 0 }))
  }, {
    global: { active: 4, pending: 20, concurrency: 4 },
    canvas: { active: 1, pending: 20, avgWaitMs: 1200, maxWaitMs: 9000, waitCount: 40 },
    http: { active: 3, pending: 20, avgWaitMs: 1000, maxWaitMs: 8000, waitCount: 40 }
  }, {
    canvas: { workers: 4, busy: 4, pending: 20, rejected: 3 }
  }, {
    availableCpus: 16, ffmpegThreads: 8, workerPoolMaxSize: 4,
    globalJobConcurrency: 8, defaultGlobalJobConcurrency: 8,
    stickerConcurrency: 6, downloadConcurrency: 6
  }, {
    driver: "supabase", syncEnabled: true, consecutiveFailures: 4,
    pendingWrites: 99, retryQueueSize: 80, lastSyncAgeMs: 60000
  }, {
    entries: 50000, nativePersistence: { available: true },
    nativePendingMutations: { pending: 1000, sent: 50000, failed: 10, batchSize: 64 },
    asyncFlushCount: 50, asyncFlushFailures: 10, asyncFlushLastMs: 250
  }, {
    zalo: { timeoutMs: 8000, retries: 0, limit: 0 },
    external: { timeoutMs: 8000, retries: 1 }
  });

  assert.ok(report.length <= command._test.MAX_SPEED_REPORT_CHARS);
  assert.match(report, /EVENT LOOP/);
  assert.match(report, /Đã rút gọn báo cáo/);
});

test("/speed run sends one report through the wrapped API without depending on Reply.text", async () => {
  let sent = null;
  let calls = 0;
  const result = await command.run({
    api: { sendMessage: async (...args) => { calls++; sent = args; return { ok: true }; } },
    event: { threadId: "test-thread", type: 1 },
    reply: { text: async () => { throw new Error("Reply.text should not be used"); } }
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 1);
  assert.equal(sent[1], "test-thread");
  assert.equal(sent[2], 1);
  assert.ok(String(sent[0]?.msg || "").length <= command._test.MAX_SPEED_REPORT_CHARS);
});


test("/speed log finds the underlying dispatcher error by its user-facing code", () => {
  const events = [
    { id: "event-1", timestamp: "2026-11-19T12:00:00.000Z", source: "command", command: "speed",
      message: "[D78F4136] Lỗi khi xử lý lệnh 'speed': TypeError: test failure at speed.js:42" },
    { id: "event-2", timestamp: "2026-11-19T12:01:00.000Z", source: "command", command: "stk",
      message: "[ABCD1234] Lỗi khi xử lý lệnh 'stk': failed" }
  ];
  const found = command._test.findCommandError(events, "d78f-4136");
  assert.equal(found.id, "event-1");
  assert.equal(command._test.findCommandError(events, "00000000"), null);
  assert.equal(command._test.normalizeErrorCode("D78F-4136"), "D78F4136");
  const report = command._test.formatCommandError(found, "D78F4136");
  assert.match(report, /TypeError: test failure/);
  assert.match(report, /Nguồn: command/);
});

test("/speed log rejects malformed error codes without reading logs", () => {
  assert.equal(command._test.findCommandError([], "D78"), null);
  assert.match(command._test.formatCommandError(null, "D78"), /Không tìm thấy mã lỗi D78/);
});
