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

function formatRows(rows, labelPrefix = "") {
  if (!Array.isArray(rows) || rows.length === 0) return ["  • Chưa có dữ liệu"];
  return rows.map(row =>
    "  • " + labelPrefix + String(row.command || "unknown") +
    ": P95 " + formatMs(row.p95Ms) +
    " · TB " + formatMs(row.avgMs) +
    " · " + Math.max(0, Number(row.count) || 0) + " mẫu"
  );
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
    .slice(0, 5);

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
    .slice(0, 4);

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

function buildSpeedReport(source = metrics, uptimeSeconds = process.uptime(), eventLoop = null, transport = null, jobQueues = null, workers = null) {
  const latency = source.getLatencyStats?.() || {};
  const commands = source.getCommandLatencyStats?.(6) || [];
  const handlers = source.getCommandExecutionLatencyStats?.(6) || [];
  const listener = source.getListenerStageLatencyStats?.(10) || [];
  const apiCalls = source.getZaloApiLatencyStats?.(6) || [];
  const firstResponse = source.getFirstResponseLatencyByCommandStats?.(6) || [];
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

  return [
    "⚡ JOHNTRAN · SPEED DIAGNOSTICS",
    "⏱️ Uptime: " + Math.floor(Math.max(0, Number(uptimeSeconds) || 0) / 60) + " phút",
    "",
    "🎯 TOÀN BỘ PIPELINE LỆNH",
    latencyLine,
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
    "🔌 HTTP FETCH / KẾT NỐI",
    ...(transport?.byHost?.length
      ? transport.byHost.slice(0, 5).map(item =>
          "  • " + String(item.host || "unknown") +
          ": P95 " + formatMs(item.p95Ms) +
          " · TB " + formatMs(item.avgMs) +
          " · " + Math.max(0, Number(item.count) || 0) + " mẫu" +
          (item.failed ? " · lỗi " + item.failed : "")
        )
      : ["  • Chưa có mẫu fetch trong phiên này"]),
    "",
    "🚦 HÀNG ĐỢI / WORKER",
    ...formatQueueAndWorkerPressure(jobQueues, workers),
    "",
    "🚀 NHẬN TIN → PHẢN HỒI ĐẦU TIÊN",
    ...formatRows(firstResponse, "/"),
    "",
    "🧠 EVENT LOOP",
    loop
      ? "P95 " + formatMs(loop.p95Ms) + " · P99 " + formatMs(loop.p99Ms) + " · Max " + formatMs(loop.maxMs)
      : "Chưa có mẫu event-loop.",
    "",
    "Ghi chú: P95 là thời gian 95% mẫu không vượt quá; API Zalo gồm cả thời gian chờ mạng.",
    "Dữ liệu chỉ là thống kê trong bộ nhớ kể từ lần bot khởi động gần nhất."
  ].join("\n");
}

module.exports.run = async function ({ api, event, reply }) {
  let eventLoop = null;
  try {
    eventLoop = require("../../core/health").getEventLoopMetrics({ reset: false });
  } catch { /* event-loop sampling is optional diagnostic data */ }
  let transport = null;
  try { transport = require("../../core/http/transport").getZaloHttpTransportStats(); }
  catch { /* HTTP diagnostics are optional */ }
  let jobQueues = null;
  let workers = null;
  try { jobQueues = require("../../core/jobQueue").stats(); } catch {}
  try { workers = require("../../core/workerPool").stats(); } catch {}
  const report = buildSpeedReport(metrics, process.uptime(), eventLoop, transport, jobQueues, workers);
  if (typeof reply?.text === "function") return reply.text(report);
  return api.sendMessage({ msg: report }, event.threadId, event.type);
};

module.exports._test = { formatMs, formatRows, formatQueueAndWorkerPressure, buildSpeedReport };
