"use strict";

const metrics = require("../../core/metrics");

module.exports.config = {
  name: "speed",
  aliases: ["latency"],
  version: "1.0.0",
  role: 2,
  author: "JOHNTRAN",
  description: "Đo độ trễ pipeline, listener và API Zalo",
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

function buildSpeedReport(source = metrics, uptimeSeconds = process.uptime()) {
  const latency = source.getLatencyStats?.() || {};
  const commands = source.getCommandLatencyStats?.(6) || [];
  const handlers = source.getCommandExecutionLatencyStats?.(6) || [];
  const listener = source.getListenerStageLatencyStats?.(10) || [];
  const apiCalls = source.getZaloApiLatencyStats?.(6) || [];
  const firstResponse = source.getFirstResponseLatencyByCommandStats?.(6) || [];

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
    "🚀 NHẬN TIN → PHẢN HỒI ĐẦU TIÊN",
    ...formatRows(firstResponse, "/"),
    "",
    "Ghi chú: P95 là thời gian 95% mẫu không vượt quá; API Zalo gồm cả thời gian chờ mạng.",
    "Dữ liệu chỉ là thống kê trong bộ nhớ kể từ lần bot khởi động gần nhất."
  ].join("\n");
}

module.exports.run = async function ({ api, event, reply }) {
  const report = buildSpeedReport();
  if (typeof reply?.text === "function") return reply.text(report);
  return api.sendMessage({ msg: report }, event.threadId, event.type);
};

module.exports._test = { formatMs, formatRows, buildSpeedReport };
