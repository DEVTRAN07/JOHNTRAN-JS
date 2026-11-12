"use strict";

const { stats: queueStats } = require("../../core/jobQueue");
const { stats: workerStats } = require("../../core/workerPool");
const { allStats: cacheStats } = require("../../core/cache");
const { mediaCache } = require("../../core/mediaCache");

module.exports.config = {
  name: "jobs",
  aliases: ["queue", "jobstatus"],
  version: "1.0.0",
  role: 1,
  author: "JOHNTRAN",
  description: "Theo dõi hàng đợi tác vụ và worker của bot",
  category: "Hệ thống",
  usage: "jobs",
  cooldowns: 3,
  dependencies: {}
};

function formatLane(name, lane) {
  const lines = [
    `• ${name}: ${lane.active} chạy / ${lane.pending} chờ (tối đa ${lane.concurrency})`,
    `  Hoàn tất ${lane.completed} · lỗi ${lane.failed} · retry ${lane.retried} · từ chối ${lane.rejected}`
  ];

  for (const job of lane.runningJobs || []) {
    lines.push(`  ↳ Đang chạy: ${job.label} · ${(job.runningForMs / 1000).toFixed(1)}s`);
  }
  for (const job of lane.pendingJobs || []) {
    lines.push(`  ↳ Đang chờ: ${job.label} · ${(job.waitingForMs / 1000).toFixed(1)}s`);
  }
  if (lane.oldestPendingMs > 0) {
    lines.push(`  ⏱️ Tác vụ chờ lâu nhất: ${(lane.oldestPendingMs / 1000).toFixed(1)}s`);
  }
  return lines.join("\n");
}

module.exports.run = async function ({ api, event }) {
  const queues = queueStats();
  const workers = workerStats();
  const caches = cacheStats();
  const media = mediaCache.stats();
  const global = queues.global || { active: 0, pending: 0, concurrency: 0, maxPending: 0 };
  const lanes = Object.entries(queues)
    .filter(([name]) => name !== "global")
    .sort(([a], [b]) => a.localeCompare(b));

  const workerLines = Object.entries(workers).map(([name, pool]) =>
    `• ${name}: ${pool.busy}/${pool.workers} worker bận · ${pool.pending}/${pool.maxPending} chờ · lỗi ${pool.failed}`
  );

  const cacheLines = Object.entries(caches).map(([name, cache]) =>
    `• ${name}: ${cache.size}/${cache.max} entries · hit ${Math.round(Number(cache.hitRate || 0) * 100)}%`
  );

  const mediaCacheLine = `• MediaCache: ${media.localFiles} file local · ${Math.round(Number(media.hitRate || 0) * 100)}% hit · ${media.uploads} lần ghi · R2 ${media.r2Configured ? "đã bật" : "local-only"}`;

  const memory = process.memoryUsage();
  const lines = [
    "⚡ SPEED ENGINE · TRẠNG THÁI TÁC VỤ",
    "",
    `🌐 Tổng: ${global.active}/${global.concurrency} tác vụ chạy · ${global.pending}/${global.maxPending} tác vụ chờ`,
    "",
    "📦 HÀNG ĐỢI",
    ...(lanes.length ? lanes.map(([name, lane]) => formatLane(name, lane)) : ["• Chưa có tác vụ nào được đưa vào queue."]),
    "",
    "🧵 WORKER POOL",
    ...(workerLines.length ? workerLines : ["• Worker chưa được khởi tạo."]),
    "",
    "🗃️ CACHE",
    ...(cacheLines.length ? cacheLines : ["• Cache chưa có dữ liệu."]),
    mediaCacheLine,
    "",
    `🧠 RAM: ${(memory.rss / 1024 / 1024).toFixed(1)} MB · Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    "",
    "Retry chỉ áp dụng cho tác vụ an toàn đã được cấu hình; bot không tự gửi lại tin nhắn Zalo để tránh gửi trùng."
  ];

  return api.sendMessage({ msg: lines.join("\n") }, event.threadId, event.type);
};
