"use strict";

const metrics = require("../../core/metrics");
const { allStats } = require("../../core/cache");

const BRAND = "JOHNTRAN";

module.exports.config = {
  name: "stats",
  aliases: ["thongke", "metrics"],
  version: "2.1.0",
  role: 0,
  author: BRAND,
  description: "Thống kê hoạt động bot và cache",
  category: "Hệ thống",
  usage: "stats",
  cooldowns: 5,
  dependencies: {}
};

module.exports.run = async ({ reply }) => {
  const daily = metrics.getDayStats();
  const cacheStats = allStats();
  const top = metrics.topCommands();
  const latency = metrics.getLatencyStats?.();

  const topLines = top.length
    ? top.map(([name, count], index) => `${index + 1}. ${name}: ${count} lần`)
    : ["Chưa có dữ liệu"];

  const cacheLines = Object.entries(cacheStats).map(([name, value]) =>
    `${name}: ${value.size}/${value.max} (hit ${value.hitRate})`
  );

  const lines = [
    "📊 THỐNG KÊ HOẠT ĐỘNG",
    `Ngày: ${daily.day}`,
    "",
    `Lệnh: ${daily.commands}  •  Lỗi: ${daily.errors}`,
    `Nhạc: ${daily.musicSearch} tìm kiếm / ${daily.musicDownload} tải`,
    `AI: ${daily.aiRequests}  •  TTS: ${daily.ttsRequests}`,
    "",
    "🏆 TOP LỆNH",
    ...topLines,
    "",
    "⚡ ĐỘ TRỄ LỆNH",
    latency
      ? `P50: ${latency.p50Ms} ms  •  P95: ${latency.p95Ms} ms  •  Gần nhất: ${latency.lastMs} ms`
      : "Chưa có dữ liệu",
    "",
    "🧠 CACHE",
    ...cacheLines,
    "",
    `${BRAND} • uptime ${Math.floor(process.uptime() / 60)} phút`
  ];

  return reply.text(lines.join("\n"));
};
