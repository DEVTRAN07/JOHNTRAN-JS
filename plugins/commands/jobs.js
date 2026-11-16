"use strict";
const fs = require("fs");
const { stats: queueStats } = require("../../core/jobQueue");
const { stats: workerStats } = require("../../core/workerPool");
const { allStats: cacheStats } = require("../../core/cache");
const { mediaCache } = require("../../core/mediaCache");
const { renderCanvas } = require("../../core/canvas/workerRender");

module.exports.config = {
  name: "jobs", aliases: ["queue", "jobstatus"], version: "2.0.0", role: 1,
  author: "JOHNTRAN", description: "Theo dõi queue và worker bằng Canvas",
  category: "Hệ thống", usage: "jobs", cooldowns: 3, dependencies: { canvas: "" }
};
function formatLane(name, lane) {
  const lines = [
    "• " + name + ": " + lane.active + " chạy / " + lane.pending + " chờ (tối đa " + lane.concurrency + ")",
    "  Hoàn tất " + lane.completed + " · lỗi " + lane.failed + " · retry " + lane.retried + " · từ chối " + lane.rejected
  ];
  for (const job of lane.runningJobs || []) lines.push("  ↳ Đang chạy: " + job.label + " · " + (job.runningForMs / 1000).toFixed(1) + "s");
  for (const job of lane.pendingJobs || []) lines.push("  ↳ Đang chờ: " + job.label + " · " + (job.waitingForMs / 1000).toFixed(1) + "s");
  if (lane.oldestPendingMs > 0) lines.push("  ⏱️ Tác vụ chờ lâu nhất: " + (lane.oldestPendingMs / 1000).toFixed(1) + "s");
  return lines.join("\n");
}
function buildText(queues, workers, caches, media, memory) {
  const g = queues.global || { active: 0, pending: 0, concurrency: 0, maxPending: 0 };
  const lanes = Object.entries(queues).filter(([n]) => n !== "global").sort(([a], [b]) => a.localeCompare(b));
  const workerLines = Object.entries(workers).map(([n, v]) => "• " + n + ": " + v.busy + "/" + v.workers + " worker bận · " + v.pending + "/" + v.maxPending + " chờ · lỗi " + v.failed);
  const cacheLines = Object.entries(caches).map(([n, v]) => "• " + n + ": " + v.size + "/" + v.max + " entries · hit " + Math.round(Number(v.hitRate || 0) * 100) + "%");
  const mediaLine = "• MediaCache: " + media.localFiles + " file local · " + Math.round(Number(media.hitRate || 0) * 100) + "% hit · " + media.uploads + " lần ghi · R2 " + (media.r2Configured ? "đã bật" : "local-only");
  return [
    "⚡ SPEED ENGINE · TRẠNG THÁI TÁC VỤ", "",
    "🌐 Tổng: " + g.active + "/" + g.concurrency + " tác vụ chạy · " + g.pending + "/" + g.maxPending + " tác vụ chờ", "",
    "📦 HÀNG ĐỢI", ...(lanes.length ? lanes.map(([n, v]) => formatLane(n, v)) : ["• Chưa có tác vụ nào được đưa vào queue."]), "",
    "🧵 WORKER POOL", ...(workerLines.length ? workerLines : ["• Worker chưa được khởi tạo."]), "",
    "🗃️ CACHE", ...(cacheLines.length ? cacheLines : ["• Cache chưa có dữ liệu."]), mediaLine, "",
    "🧠 RAM: " + (memory.rss / 1048576).toFixed(1) + " MB · Heap: " + (memory.heapUsed / 1048576).toFixed(1) + " MB", "",
    "Retry chỉ áp dụng cho tác vụ an toàn đã được cấu hình; bot không tự gửi lại tin nhắn Zalo để tránh gửi trùng."
  ].join("\n");
}
function cleanup(file) {
  if (!file) return;
  const timer = setTimeout(() => { try { fs.rmSync(file, { force: true }); } catch {} }, 60000);
  timer.unref?.();
}
module.exports.run = async function ({ api, event }) {
  const queues = queueStats(), workers = workerStats(), caches = cacheStats();
  const media = mediaCache.stats(), memory = process.memoryUsage();
  const fallback = buildText(queues, workers, caches, media, memory);
  const globalQueue = queues.global || { active: 0, pending: 0, concurrency: 0, maxPending: 0 };
  const lanes = Object.entries(queues).filter(([n]) => n !== "global").sort(([a], [b]) => a.localeCompare(b))
    .map(([name, lane]) => Object.assign({ name }, lane));
  const workerRows = Object.entries(workers).map(([name, data]) => Object.assign({ name }, data));
  const cacheRows = Object.entries(caches).map(([name, data]) => ({ name, size: data.size, max: data.max, hitRate: data.hitRate }));
  let imagePath;
  try {
    imagePath = await renderCanvas("jobs", {
      global: globalQueue, lanes, workers: workerRows, caches: cacheRows, media,
      memory: { rssMb: memory.rss / 1048576, heapMb: memory.heapUsed / 1048576 },
      uptime: Math.floor(process.uptime() / 60) + " phút"
    }, { timeout: 30000, poolSize: 2 });
    return await api.sendMessage({ msg: "", attachments: [imagePath], ttlKind: "card" }, event.threadId, event.type);
  } catch (error) {
    console.error("[JOBS_CANVAS]", error?.stack || error);
    return api.sendMessage({ msg: fallback }, event.threadId, event.type);
  } finally { cleanup(imagePath); }
};
module.exports._test = { formatLane, buildText };
