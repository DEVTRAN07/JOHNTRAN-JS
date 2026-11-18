"use strict";
const fs = require("fs");
const metrics = require("../../core/metrics");
const { allStats } = require("../../core/cache");
const { renderCanvas } = require("../../core/canvas/workerRender");
const { getEventLoopMetrics } = require("../../core/health");
const BRAND = "JOHNTRAN";

module.exports.config = {
  name: "stats", aliases: ["thongke", "metrics"], version: "3.0.0", role: 0,
  author: BRAND, description: "Thống kê hoạt động bot và cache dạng Canvas",
  category: "Hệ thống", usage: "stats", cooldowns: 5, dependencies: { canvas: "" }
};
function buildText(daily, caches, top, latency, slow, handlers, firstResponse = null, listenerStages = [], apiCalls = [], eventLoop = null) {
  const topLines = top.length ? top.map((v, i) => (i + 1) + ". " + v[0] + ": " + v[1] + " lần") : ["Chưa có dữ liệu"];
  const cacheLines = Object.entries(caches).map(([n, v]) => n + ": " + v.size + "/" + v.max + " (hit " + v.hitRate + ")");
  const slowLines = slow.length ? slow.map(v => v.command + ": P95 " + v.p95Ms + " ms · TB " + v.avgMs + " ms") : ["Chưa đủ dữ liệu"];
  const handlerLines = handlers.length ? handlers.map(v => v.command + ": P95 " + v.p95Ms + " ms · TB " + v.avgMs + " ms") : ["Chưa đủ dữ liệu"];
  const firstResponseLine = firstResponse
    ? "P50: " + firstResponse.p50Ms + " ms · P95: " + firstResponse.p95Ms + " ms · TB: " + firstResponse.avgMs + " ms (" + firstResponse.count + " mẫu)"
    : "Chưa có mẫu phản hồi đầu tiên";
  const listenerLines = listenerStages.length
    ? listenerStages.map(v => v.command + ": P95 " + v.p95Ms + " ms · TB " + v.avgMs + " ms")
    : ["Chưa đủ dữ liệu"];
  const apiLines = apiCalls.length
    ? apiCalls.map(v => v.command + ": P95 " + v.p95Ms + " ms · TB " + v.avgMs + " ms")
    : ["Chưa đủ dữ liệu"];
  return [
    "📊 THỐNG KÊ HOẠT ĐỘNG", "Ngày: " + daily.day, "",
    "Lệnh: " + daily.commands + "  •  Lỗi: " + daily.errors,
    "Nhạc: " + daily.musicSearch + " tìm kiếm / " + daily.musicDownload + " tải",
    "AI: " + daily.aiRequests + "  •  TTS: " + daily.ttsRequests, "",
    "🏆 TOP LỆNH", ...topLines, "", "⚡ ĐỘ TRỄ LỆNH",
    latency ? "P50: " + latency.p50Ms + " ms  •  P95: " + latency.p95Ms + " ms  •  Gần nhất: " + latency.lastMs + " ms" : "Chưa có dữ liệu",
    "🚀 NHẬN TIN → PHẢN HỒI ĐẦU TIÊN", firstResponseLine,
    "🧭 CÁC CHẶNG LISTENER", ...listenerLines,
    "📡 THỜI GIAN API ZALO", ...apiLines,
    "🧠 EVENT LOOP", eventLoop
      ? "P95: " + eventLoop.p95Ms + " ms · P99: " + eventLoop.p99Ms + " ms"
      : "Chưa có mẫu event-loop", "",
    "🐢 LỆNH CHẬM (TOÀN BỘ ĐƯỜNG XỬ LÝ)", ...slowLines,
    "⚙️ HANDLER CHẬM (CHỈ PHẦN COMMAND.RUN)", ...handlerLines, "", "🧠 CACHE", ...cacheLines, "",
    BRAND + " • uptime " + Math.floor(process.uptime() / 60) + " phút"
  ].join("\n");
}
function cleanup(file) {
  if (!file) return;
  const timer = setTimeout(() => { try { fs.rmSync(file, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}
module.exports.run = async function ({ api, event, reply }) {
  const daily = metrics.getDayStats(), caches = allStats(), top = metrics.topCommands();
  const latency = metrics.getLatencyStats?.();
  const slow = metrics.getCommandLatencyStats?.(5) || [];
  const handlers = metrics.getCommandExecutionLatencyStats?.(5) || [];
  const firstResponse = metrics.getFirstResponseLatencyStats?.() || null;
  const listenerStages = metrics.getListenerStageLatencyStats?.(5) || [];
  const apiCalls = metrics.getZaloApiLatencyStats?.(5) || [];
  const eventLoop = getEventLoopMetrics();
  const fallback = buildText(daily, caches, top, latency, slow, handlers, firstResponse, listenerStages, apiCalls, eventLoop);
  let imagePath;
  try {
    imagePath = await renderCanvas("stats", {
      daily, latency: latency || {}, firstResponse, listenerStages, apiCalls, eventLoop, topCommands: top, slowCommands: slow, slowHandlers: handlers,
      caches: Object.entries(caches).map(([name, v]) => ({ name, size: v.size, max: v.max, hitRate: v.hitRate })),
      uptime: Math.floor(process.uptime() / 60) + " phút"
    }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[STATS_CANVAS]", error?.stack || error);
    if (typeof reply?.text === "function") return reply.text(fallback);
    return api.sendMessage({ msg: fallback }, event.threadId, event.type);
  } finally { cleanup(imagePath); }
};
module.exports._test = { buildText };
