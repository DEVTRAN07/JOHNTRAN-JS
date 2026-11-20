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
  const suffix = "\n… Đã rút gọn báo cáo để bảo đảm gửi được qua Zalo.";
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
  const firstResponseStart = readMetric("getFirstResponseStartLatencyByCommandStats", 3) || [];
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
    "🚀 NHẬN TIN → BẮT ĐẦU GỬI LẦN ĐẦU",
    ...formatRows(firstResponseStart, "/"),
    "",
    "📨 NHẬN TIN → PHẢN HỒI ĐẦU TIÊN HOÀN TẤT",
    ...formatRows(firstResponse, "/"),
    "",
    "Ghi chú: mốc bắt đầu gửi đo xử lý nội bộ trước API; mốc hoàn tất có cả thời gian chờ Zalo. P95 là thời gian 95% mẫu không vượt quá.",
    "Dữ liệu chỉ là thống kê trong bộ nhớ kể từ lần bot khởi động gần nhất."
  ].join("\n");
  return limitSpeedReport(report);
}

function buildLatencyDiagnosis({ delivery = null, firstStart = null, firstComplete = null, sendMessage = null, eventLoop = null } = {}) {
  const sampleCount = Math.max(0, Number(firstStart?.count) || 0);
  const deliveryP95 = Number(delivery?.p95Ms);
  const startP95 = Number(firstStart?.p95Ms);
  const completeP95 = Number(firstComplete?.p95Ms);
  const sendP95 = Number(sendMessage?.p95Ms);
  const loopP99 = Number(eventLoop?.p99Ms);
  const loopMax = Number(eventLoop?.maxMs);

  let cause = "Chưa đủ mẫu để kết luận";
  let explanation = "Hãy gửi vài lệnh văn bản đơn giản, sau đó chạy lại /speed diagnose.";
  let severity = "unknown";

  if (sampleCount >= 3) {
    if (Number.isFinite(deliveryP95) && deliveryP95 >= 2000) {
      cause = "Độ trễ trước khi bot nhận tin (Zalo/WebSocket hoặc mạng)";
      explanation = "Timestamp trong tin đã cũ trước khi listener của bot nhận được event. Tối ưu command handler sẽ không sửa được đoạn trễ này.";
      severity = "upstream";
    } else if ((Number.isFinite(loopP99) && loopP99 >= 150) ||
               (Number.isFinite(loopMax) && loopMax >= 750)) {
      cause = "Event loop của tiến trình bị nghẽn";
      explanation = "Node.js không xử lý callback đúng hạn; cần tìm tác vụ đồng bộ nặng hoặc CPU/RAM bị tranh chấp.";
      severity = "event-loop";
    } else if (Number.isFinite(sendP95) && sendP95 >= 1500) {
      cause = "Request gửi tin tới Zalo chậm";
      explanation = "Bot đã bắt đầu gửi nhưng API sendMessage mất nhiều thời gian mới hoàn tất. Cần kiểm tra kết nối máy chủ và phản hồi từ Zalo.";
      severity = "zalo-send";
    } else if (Number.isFinite(startP95) && startP95 >= 1000) {
      cause = "Pipeline nội bộ trước phản hồi đầu tiên chậm";
      explanation = "Độ trễ phát sinh sau khi bot nhận tin nhưng trước khi gọi API gửi; cần khoanh vùng listener, phân quyền hoặc handler của lệnh.";
      severity = "bot-pipeline";
    } else if (Number.isFinite(completeP95) && completeP95 >= 2000) {
      cause = "Độ trễ chưa khớp với các chặng đã đo";
      explanation = "Thời gian hoàn tất phản hồi cao nhưng các chỉ số thành phần chưa chỉ ra một điểm nghẽn rõ ràng; cần xem log và mẫu chi tiết.";
      severity = "unclassified";
    } else {
      cause = "Chưa thấy nghẽn lớn trong các mẫu gần đây";
      explanation = "Nếu người dùng vẫn thấy chậm, hãy so sánh thời điểm gửi thực tế với timestamp Zalo và kiểm tra bot có đang chạy đúng commit mới nhất không.";
      severity = "healthy";
    }
  }

  const metricLine = (label, value) =>
    label + ": " + (Number.isFinite(Number(value)) ? formatMs(value) : "chưa có mẫu");

  return {
    sampleCount,
    cause,
    explanation,
    severity,
    lines: [
      "⚡ JOHNTRAN · SPEED DIAGNOSIS",
      "Mẫu receive → send: " + sampleCount,
      "NGHI VẤN: " + cause,
      explanation,
      "",
      metricLine("Zalo tạo tin → bot nhận (P95)", delivery?.p95Ms),
      metricLine("Bot nhận → bắt đầu gửi (P95)", firstStart?.p95Ms),
      metricLine("API sendMessage (P95)", sendMessage?.p95Ms),
      metricLine("Nhận tin → gửi xong (P95)", firstComplete?.p95Ms),
      "Event loop: P99 " + (Number.isFinite(loopP99) ? formatMs(loopP99) : "chưa có mẫu") +
        " · Max " + (Number.isFinite(loopMax) ? formatMs(loopMax) : "chưa có mẫu"),
      "",
      "Chạy /speed diagnose sau vài lệnh văn bản đơn giản để lấy mẫu mới."
    ]
  };
}

function normalizeErrorCode(value) {
  return String(value ?? "").trim().replace(/[^a-f0-9]/gi, "").toUpperCase().slice(0, 8);
}

function findCommandError(events, code) {
  const target = normalizeErrorCode(code);
  if (target.length !== 8 || !Array.isArray(events)) return null;
  return events.find(item =>
    String(item?.message || "").toUpperCase().includes("[" + target + "]")
  ) || null;
}

function formatCommandError(event, code) {
  if (!event) {
    return [
      "⚠️ Không tìm thấy mã lỗi " + normalizeErrorCode(code) + ".",
      "Có thể bot chưa chạy bản có Error Journal, hoặc log đã bị xoay/xóa.",
      "Hãy kiểm tra log server tại thời điểm xảy ra lỗi."
    ].join("\n");
  }
  return [
    "🔎 JOHΝTRAN · ERROR TRACE",
    "Mã: " + normalizeErrorCode(code),
    "Thời gian: " + String(event.timestamp || "không rõ"),
    "Nguồn: " + String(event.source || "unknown"),
    "Lệnh: " + String(event.command || "unknown"),
    "",
    "Stack / nguyên nhân:",
    String(event.message || "Không có nội dung log").slice(0, 1200)
  ].join("\n");
}

module.exports.run = async function ({ api, event, reply, args = [] } = {}) {
  const action = String(args?.[0] || "").trim().toLowerCase();
  if (action === "diagnose" || action === "diag") {
    const eventLoop = safeRead(() => require("../../core/health").getEventLoopMetrics({ reset: false }), null);
    const diagnosis = buildLatencyDiagnosis({
      delivery: safeRead(() => metrics.getMessageDeliveryAgeStats(), null),
      firstStart: safeRead(() => metrics.getFirstResponseStartLatencyStats(), null),
      firstComplete: safeRead(() => metrics.getFirstResponseLatencyStats(), null),
      sendMessage: safeRead(() => metrics.getZaloApiLatencyStats(20).find(item => item.command === "sendMessage"), null),
      eventLoop
    });
    return api.sendMessage({ msg: diagnosis.lines.join("\\n") }, event.threadId, event.type);
  }
  if (action === "log" || action === "error" || action === "trace") {
    const code = normalizeErrorCode(args?.[1]);
    if (code.length !== 8) {
      const usage = "Cách dùng: /speed log D78F4136";
      if (typeof reply?.text === "function") return reply.text(usage);
      return api.sendMessage({ msg: usage }, event.threadId, event.type);
    }
    const events = safeRead(
      () => require("../../core/runtime/errorJournal").snapshot(200).events,
      []
    );
    const detail = formatCommandError(findCommandError(events, code), code);
    if (typeof reply?.text === "function") return reply.text(detail);
    return api.sendMessage({ msg: detail }, event.threadId, event.type);
  }

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
module.exports._test = { buildLatencyDiagnosis,  MAX_SPEED_REPORT_CHARS, limitSpeedReport, safeRead, normalizeErrorCode, findCommandError, formatCommandError, formatMs, formatRows, formatQueueAndWorkerPressure, formatMediaResources, formatStorageDiagnostics, formatMessageCacheDiagnostics, formatRequestPolicy, formatMessageDeliveryAge, buildSpeedReport };
