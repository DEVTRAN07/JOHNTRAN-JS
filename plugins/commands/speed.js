"use strict";

const metrics = require("../../core/metrics");

module.exports.config = {
  name: "speed",
  aliases: ["latency"],
  version: "1.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Đo pipeline, HTTP fetch, kết nối và API Zalo",
  category: "Hệ thống",
  usage: "speed",
  cooldowns: 3,
  requiresUserData: false
};

function formatMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) + " ms" : "—";
}

function formatRows(rows, labelPrefix = "", maxRows = 3) {
  if (!Array.isArray(rows) || rows.length === 0) return ["  • Chưa có dữ liệu"];
  const visibleRows = rows.slice(0, Math.max(1, maxRows));
  const lines = visibleRows.map(row =>
    "  • " + labelPrefix + String(row.command || "unknown") +
    ": P95 " + formatMs(row.p95Ms) +
    " · TB " + formatMs(row.avgMs) +
    " · " + Math.max(0, Number(row.count) || 0) + " mẫu"
  );
  if (rows.length > visibleRows.length) lines.push("  • … và " + (rows.length - visibleRows.length) + " mục khác");
  return lines;
}

function formatQueueAndWorkerPressure(jobQueues = null, workers = null) {
  const lines = [];
  const globalQueue = jobQueues?.global;
  if (globalQueue) {
    lines.push(
      "  • Global: " +
      Math.max(0, Number(globalQueue.active) || 0) + "/" +
      Math.max(0, Number(globalQueue.concurrency) || 0) + " slot · chờ " +
      Math.max(0, Number(globalQueue.pending) || 0)
    );
  } else {
    lines.push("  • Global queue: chưa có mẫu");
  }

  const lanes = Object.entries(jobQueues || {})
    .filter(([name, lane]) => name !== "global" && lane && (
      Number(lane.active) > 0 || Number(lane.pending) > 0 || Number(lane.waitCount) > 0
    ))
    .sort((a, b) => (Number(b[1].pending) || 0) - (Number(a[1].pending) || 0) ||
      (Number(b[1].active) || 0) - (Number(a[1].active) || 0))
    .slice(0, 3);

  if (lanes.length) {
    for (const [name, lane] of lanes) {
      lines.push(
        "  • " + name + ": active " + Math.max(0, Number(lane.active) || 0) +
        " · pending " + Math.max(0, Number(lane.pending) || 0) +
        " · wait TB " + formatMs(lane.avgWaitMs) +
        " · max " + formatMs(lane.maxWaitMs)
      );
    }
  } else if (!jobQueues || !Object.keys(jobQueues).length) {
    lines.push("  • Các lane: chưa có mẫu");
  } else {
    lines.push("  • Các lane: không có tác vụ đang chờ");
  }

  const pools = Object.entries(workers || {})
    .filter(([, pool]) => pool && (Number(pool.workers) > 0 || Number(pool.pending) > 0 || Number(pool.rejected) > 0))
    .sort((a, b) => (Number(b[1].pending) || 0) - (Number(a[1].pending) || 0))
    .slice(0, 2);

  if (pools.length) {
    for (const [name, pool] of pools) {
      lines.push(
        "  • Worker " + name + ": busy " + Math.max(0, Number(pool.busy) || 0) +
        "/" + Math.max(0, Number(pool.workers) || 0) +
        " · pending " + Math.max(0, Number(pool.pending) || 0) +
        " · reject " + Math.max(0, Number(pool.rejected) || 0)
      );
    }
  } else if (!workers || !Object.keys(workers).length) {
    lines.push("  • Worker pools: chưa có mẫu");
  } else {
    lines.push("  • Worker pools: chưa khởi tạo");
  }

  return lines;
}

function formatMediaResources(resources = null) {
  if (!resources) return ["  • Chưa đọc được cấu hình tài nguyên media"];
  return [
    "  • CPU khả dụng: " + Math.max(1, Number(resources.availableCpus) || 1) + " lõi",
    "  • FFmpeg: " + Math.max(1, Number(resources.ffmpegThreads) || 1) + " thread/lượt",
    "  • Worker pool: tối đa " + Math.max(1, Number(resources.workerPoolMaxSize) || 1) + " worker/pool",
    "  • Global media queue: " + Math.max(1, Number(resources.globalJobConcurrency) || 1) + " job (mặc định CPU: " + Math.max(1, Number(resources.defaultGlobalJobConcurrency) || 1) + ")",
    "  • STK: " + Math.max(1, Number(resources.stickerConcurrency) || 1) + " job đồng thời",
    "  • Tải media: " + Math.max(1, Number(resources.downloadConcurrency) || 1) + " job đồng thời"
  ];
}

function formatStorageDiagnostics(storage = null, now = Date.now()) {
  if (!storage || typeof storage !== "object") {
    return ["  • Chưa đọc được trạng thái database"];
  }

  const driver = String(storage.driver || "unknown").toLowerCase();
  const lines = ["  • Driver: " + driver.toUpperCase()];

  if (driver === "json") {
    const writer = storage.writer || {};
    lines.push(
      "  • JSON writer: " + (
        writer.enabled === true
          ? (writer.ready === true ? "background worker hoạt động" : "đang khởi tạo")
          : "không hoạt động (đang dùng fallback)"
      ),
      "  • Pending flush: " + (storage.pendingFlush === true ? "có" : "không"),
      "  • Snapshot: " + Math.max(0, Number(writer.persistedSequence) || 0) +
        "/" + Math.max(0, Number(writer.sequence) || 0) + " đã ghi"
    );
    if (storage.lastFlushAt) {
      lines.push("  • Lần ghi gần nhất: " +
        formatMs(Math.max(0, now - Number(storage.lastFlushAt))) + " trước");
    }
    if (storage.lastFlushError) lines.push("  • Flush lỗi: có (xem log server)");
  } else if (driver === "supabase") {
    lines.push(
      "  • Sync: " + (storage.syncEnabled === false ? "tắt" : "bật") +
        " · lỗi liên tiếp " + Math.max(0, Number(storage.consecutiveFailures) || 0),
      "  • Pending writes: " + Math.max(0, Number(storage.pendingWrites) || 0) +
        " · retry queue: " + Math.max(0, Number(storage.retryQueueSize) || 0)
    );
    if (storage.lastSyncAgeMs != null) {
      lines.push("  • Lần sync gần nhất: " + formatMs(storage.lastSyncAgeMs) + " trước");
    }
    if (storage.syncError) lines.push("  • Sync lỗi: có (xem log server)");
  } else {
    lines.push("  • Trạng thái: " + (storage.ok === true ? "OK" : "không xác định"));
  }

  return lines;
}

function getStorageDiagnostics() {
  try {
    const database = require("../../utils/db");
    const backend = database?.db;
    // Supabase exposes queue/retry counters in its in-memory getStatus().
    if (typeof backend?.healthCheck === "function" &&
        typeof backend?.getStatus === "function") {
      return backend.getStatus();
    }
    // JSON getOperationalStatus() is memory-only and never probes the disk.
    return database?.getOperationalStatus?.() ||
      backend?.getOperationalStatus?.() ||
      null;
  } catch {
    return null;
  }
}

function formatMessageDeliveryAge(stats = null) {
  if (!stats || typeof stats !== "object" || !Number(stats.count)) {
    return "  • Chưa có timestamp Zalo hợp lệ trong phiên này";
  }
  return "  • Zalo tạo tin → bot nhận: P95 " + formatMs(stats.p95Ms) +
    " · TB " + formatMs(stats.avgMs) +
    " · Max " + formatMs(stats.maxMs) +
    " · " + Math.max(0, Number(stats.count) || 0) + " mẫu";
}

function formatRequestPolicy(policy = null) {
  if (!policy || typeof policy !== "object") {
    return ["  • Chưa đọc được chính sách timeout/retry"];
  }
  const formatOne = (label, value) => {
    if (!value || typeof value !== "object") return "  • " + label + ": không rõ";
    return "  • " + label + ": timeout " +
      Math.max(0, Number(value.timeoutMs) || 0) + " ms · retry " +
      Math.max(0, Number(value.limit ?? value.retries) || 0);
  };
  return [
    formatOne("Zalo API", policy.zalo),
    formatOne("HTTP ngoài", policy.external),
    "  • Retry chỉ áp dụng GET/HEAD; POST không tự gửi lại"
  ];
}

function formatMessageCacheDiagnostics(stats = null) {
  if (!stats || typeof stats !== "object") {
    return ["  • Chưa đọc được message-cache"];
  }
  const native = stats.nativePersistence || {};
  const mutations = stats.nativePendingMutations || {};
  return [
    "  • Bản ghi đang giữ: " + Math.max(0, Number(stats.entries) || 0),
    "  • Rust sidecar: " + (native.available === true ? "đang hoạt động" : "không hoạt động (fallback)"),
    "  • IPC queue: chờ " + Math.max(0, Number(mutations.pending) || 0) +
      " · đã gửi " + Math.max(0, Number(mutations.sent) || 0) +
      " · lỗi " + Math.max(0, Number(mutations.failed) || 0) +
      " · batch " + Math.max(1, Number(mutations.batchSize) || 1),
    "  • Flush: " + Math.max(0, Number(stats.asyncFlushCount) || 0) +
      " · lỗi " + Math.max(0, Number(stats.asyncFlushFailures) || 0) +
      " · lần gần nhất " + formatMs(stats.asyncFlushLastMs)
  ];
}

function getMessageCacheDiagnostics() {
  try { return require("../../utils/messageCache").getMessageCacheStats(); }
  catch { return null; }
}

const MAX_SPEED_REPORT_CHARS = 1800;

function limitSpeedReport(report, maxChars = MAX_SPEED_REPORT_CHARS) {
  const value = String(report ?? "");
  const limit = Math.max(128, Number(maxChars) || MAX_SPEED_REPORT_CHARS);
  if (value.length <= limit) return value;
  const suffix = "\\n… Đã rút gọn báo cáo để bảo đảm gửi được qua Zalo.";
  let end = Math.max(0, limit - suffix.length);
  const code = value.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end--;
  return value.slice(0, end).trimEnd() + suffix;
}

function safeRead(read, fallback = null) {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function buildSpeedReport(source = metrics, uptimeSeconds = process.uptime(), eventLoop = null, transport = null, jobQueues = null, workers = null, mediaResources = null, storage = null, messageCache = null, requestPolicy = null) {
  const readMetric = (name, ...args) => safeRead(
    () => typeof source?.[name] === "function" ? source[name](...args) : undefined,
    null
  );
  const latency = readMetric("getLatencyStats") || {};
  const commands = readMetric("getCommandLatencyStats", 3) || [];
  const handlers = readMetric("getCommandExecutionLatencyStats", 3) || [];
  const listener = readMetric("getListenerStageLatencyStats", 4) || [];
  const apiCalls = readMetric("getZaloApiLatencyStats", 3) || [];
  const sdkPhases = readMetric("getZaloSdkPhaseLatencyStats", 3) || [];
  const firstResponse = readMetric("getFirstResponseLatencyByCommandStats", 3) || [];
  const messageDeliveryAge = readMetric("getMessageDeliveryAgeStats") || null;
  const loop = eventLoop;

  const totalSamples = Math.max(0, Number(latency.count) || 0);
  const latencyLine = totalSamples
    ? "Mẫu: " + totalSamples +
      " · TB " + formatMs(latency.avgMs) +
      " · P50 " + formatMs(latency.p50Ms) +
      " · P95 " + formatMs(latency.p95Ms) +
      " · Max " + formatMs(latency.maxMs) +
      " · Gần nhất " + formatMs(latency.lastMs)
    : "Chưa có mẫu lệnh trong phiên này.";

  const report = [
    "⚡ JOHNTRAN · SPEED DIAGNOSTICS",
    "⏱️ Uptime: " + Math.floor(Math.max(0, Number(uptimeSeconds) || 0) / 60) + " phút",
    "",
    "🎯 TOÀN BỘ PIPELINE LỆNH",
    latencyLine,
    "",
    "🧠 EVENT LOOP",
    loop
      ? "P95 " + formatMs(loop.p95Ms) + " · P99 " + formatMs(loop.p99Ms) + " · Max " + formatMs(loop.maxMs)
      : "Chưa có mẫu event-loop.",
    "",
    "🌐 ĐỘ TRỄ TRƯỚC KHI BOT NHẬN TIN",
    formatMessageDeliveryAge(messageDeliveryAge),
    "",
    "🐢 LỆNH CÓ P95 CAO",
    ...formatRows(commands, "/"),
    "",
    "🧩 THỜI GIAN RIÊNG CỦA HANDLER",
    ...formatRows(handlers, "/"),
    "",
    "🧭 CÁC CHẶNG LISTENER / STORAGE",
    ...formatRows(listener),
    "",
    "📡 API ZALO",
    ...formatRows(apiCalls),
    "",
    "🧰 CÁC PHA BÊN TRONG ZALO-CLIENT",
    ...formatRows(sdkPhases),
    "",
    "🔌 HTTP FETCH / KẾT NỐI",
    ...(transport?.byHost?.length
      ? transport.byHost.slice(0, 3).map(item =>
          "  • " + String(item.host || "unknown") +
          ": P95 " + formatMs(item.p95Ms) +
          " · TB " + formatMs(item.avgMs) +
          " · " + Math.max(0, Number(item.count) || 0) + " mẫu" +
          (item.failed ? " · lỗi " + item.failed : "")
        )
      : ["  • Chưa có mẫu fetch trong phiên này"]),
    "",
    "⚡ REQUEST TIMEOUT / RETRY",
    ...formatRequestPolicy(requestPolicy),
    "",
    "🗄️ DATABASE / PERSISTENCE",
    ...formatStorageDiagnostics(storage),
    "",
    "📨 MESSAGE CACHE / RUST IPC",
    ...formatMessageCacheDiagnostics(messageCache),
    "",
    "🚦 HÀNG ĐỢI / WORKER",
    ...formatQueueAndWorkerPressure(jobQueues, workers),
    "",
    "🧮 GIỚI HẠN TÀI NGUYÊN MEDIA",
    ...formatMediaResources(mediaResources),
    "",
    "🚀 NHẬN TIN → PHẢN HỒI ĐẦU TIÊN",
    ...formatRows(firstResponse, "/"),
    "",
    "Ghi chú: P95 là thời gian 95% mẫu không vượt quá; API Zalo gồm cả thời gian chờ mạng.",
    "Dữ liệu chỉ là thống kê trong bộ nhớ kể từ lần bot khởi động gần nhất."
  ].join("\n");
  return limitSpeedReport(report);
}

module.exports.run = async function ({ api, event, reply } = {}) {
  const eventLoop = safeRead(() => require("../../core/health").getEventLoopMetrics({ reset: false }), null);
  const transport = safeRead(() => require("../../core/http/transport").getZaloHttpTransportStats(), null);
  const jobQueues = safeRead(() => require("../../core/jobQueue").stats(), null);
  const workers = safeRead(() => require("../../core/workerPool").stats(), null);
  const mediaResources = safeRead(() => {
    const limits = require("../../core/mediaResourceLimits");
    const queue = require("../../core/jobQueue");
    const workerPool = require("../../core/workerPool");
    return {
      availableCpus: limits.getAvailableCpuCount(),
      ffmpegThreads: limits.FFMPEG_THREADS,
      workerPoolMaxSize: workerPool.DEFAULT_POOL_SIZE,
      globalJobConcurrency: queue.GLOBAL_CONCURRENCY,
      defaultGlobalJobConcurrency: queue.DEFAULT_GLOBAL_JOB_CONCURRENCY,
      stickerConcurrency: queue.STICKER_CONCURRENCY,
      downloadConcurrency: queue.DOWNLOAD_CONCURRENCY
    };
  }, null);
  const storage = safeRead(getStorageDiagnostics, null);
  const messageCache = safeRead(getMessageCacheDiagnostics, null);
  const requestPolicy = safeRead(() => {
    const resolvePolicy = require("../../core/http/requestPolicy").resolveRequestPolicy;
    return {
      zalo: require("../../core/login").resolveZaloRetryPolicy(),
      external: resolvePolicy(process.env, {}, "JT_HTTP")
    };
  }, null);

  let report;
  try {
    report = buildSpeedReport(
      metrics, process.uptime(), eventLoop, transport, jobQueues,
      workers, mediaResources, storage, messageCache, requestPolicy
    );
  } catch (error) {
    try {
      require("../../utils/logger").log(
        "Không thể dựng báo cáo /speed: " + (error?.stack || error?.message || String(error)),
        "error",
        { source: "speed-command" }
      );
    } catch { /* Logging is non-critical. */ }
    report = [
      "⚡ JOHNTRAN · SPEED DIAGNOSTICS",
      "Không thể đọc đầy đủ số liệu trong phiên này.",
      "Event loop: " + (eventLoop ? formatMs(eventLoop.p95Ms) : "không có dữ liệu"),
      "HTTP transport: " + (transport?.enabled ? "đang bật" : "không có dữ liệu"),
      "Vui lòng kiểm tra log server với source speed-command."
    ].join("\n");
  }

  report = limitSpeedReport(report);
  if (typeof api?.sendMessage === "function" && event?.threadId && event?.type !== undefined) {
    return api.sendMessage({ msg: report }, event.threadId, event.type);
  }
  if (typeof reply?.text === "function") return reply.text(report);
  throw new Error("/speed không có API hợp lệ để gửi báo cáo.");
};
module.exports._test = { MAX_SPEED_REPORT_CHARS, limitSpeedReport, safeRead, formatMs, formatRows, formatQueueAndWorkerPressure, formatMediaResources, formatStorageDiagnostics, formatMessageCacheDiagnostics, formatRequestPolicy, formatMessageDeliveryAge, buildSpeedReport };
