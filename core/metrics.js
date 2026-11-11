const fs = require("fs");
const path = require("path");
const { db } = require("./runtime/adapters/database");

const METRICS_TABLE = "Metrics";
const AUDIT_FILE = path.join(__dirname, "..", "data", "audit.log");

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDayStats(day = todayKey()) {
  const record = db.get(METRICS_TABLE, "day", day);
  if (record) return record.data;
  const fresh = { day, commands: 0, errors: 0, musicSearch: 0, musicDownload: 0, aiRequests: 0, ttsRequests: 0, byCommand: {} };
  db.set(METRICS_TABLE, "day", day, fresh);
  return fresh;
}

function saveDayStats(stats) {
  db.set(METRICS_TABLE, "day", stats.day, stats);
}

function track(event, meta = {}) {
  try {
    const stats = getDayStats();
    const field = {
      command: "commands",
      error: "errors",
      musicSearch: "musicSearch",
      musicDownload: "musicDownload",
      aiRequest: "aiRequests",
      ttsRequest: "ttsRequests"
    }[event];
    if (!field) return;
    stats[field] = (stats[field] || 0) + 1;
    if (event === "command" && meta.command) {
      stats.byCommand[meta.command] = (stats.byCommand[meta.command] || 0) + 1;
    }
    saveDayStats(stats);
  } catch (error) {
    // metrics lỗi không được làm hỏng bot
  }
}

function topCommands(day = todayKey(), limit = 5) {
  const stats = getDayStats(day);
  return Object.entries(stats.byCommand)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function allDays() {
  return db.all(METRICS_TABLE).map((row) => row.data);
}

function audit(action, actor, detail = "") {
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    const line = `[${new Date().toISOString()}] ${action} | user:${actor || "system"} ${detail ? `| ${detail}` : ""}\n`;
    fs.appendFileSync(AUDIT_FILE, line, "utf8");
  } catch {
    // audit lỗi cũng không được làm hỏng bot
  }
}

function readAudit(limit = 50) {
  try {
    const content = fs.readFileSync(AUDIT_FILE, "utf8");
    return content.trim().split("\n").slice(-limit);
  } catch {
    return [];
  }
}

module.exports = { track, getDayStats, topCommands, allDays, audit, readAudit };
