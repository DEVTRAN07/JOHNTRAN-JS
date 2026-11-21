"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

function getFiles(root = ROOT) {
  const dataDir = path.join(root, "data");
  return {
    dataDir,
    requestFile: path.join(dataDir, "update-request.json"),
    resultFile: path.join(dataDir, "update-result.json")
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
}

function readJson(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writeUpdateRequest(root = ROOT, details = {}) {
  const threadId = typeof details.threadId === "string"
    ? details.threadId.trim()
    : Number.isFinite(details.threadId) ? String(details.threadId) : "";
  const threadType = typeof details.threadType === "string" || Number.isFinite(details.threadType)
    ? details.threadType
    : null;
  if (!threadId || threadType === null) {
    throw new Error("Thiếu threadId/threadType để gửi kết quả cập nhật về Zalo.");
  }

  const files = getFiles(root);
  const request = {
    id: crypto.randomUUID(),
    botName: String(details.botName || "main"),
    threadId,
    threadType,
    createdAt: Date.now()
  };
  fs.rmSync(files.resultFile, { force: true });
  writeJsonAtomic(files.requestFile, request);
  return request;
}

function readUpdateRequest(root = ROOT) {
  return readJson(getFiles(root).requestFile);
}

function clearUpdateRequest(root = ROOT, requestId = "") {
  const filePath = getFiles(root).requestFile;
  const current = readJson(filePath);
  if (!current || !requestId || current.id !== requestId) return false;
  fs.rmSync(filePath, { force: true });
  return true;
}

function completeUpdate(root = ROOT, result = {}) {
  const files = getFiles(root);
  const request = readUpdateRequest(root);
  if (!request) return null;

  const report = {
    ...request,
    status: result.status === "success" ? "success" : "failed",
    updated: result.updated === true,
    oldVersion: String(result.oldVersion || "unknown"),
    newVersion: String(result.newVersion || result.oldVersion || "unknown"),
    oldSha: String(result.oldSha || ""),
    newSha: String(result.newSha || ""),
    changedFiles: Math.max(0, Number(result.changedFiles) || 0),
    error: String(result.error || "").slice(0, 700),
    completedAt: Date.now()
  };

  writeJsonAtomic(files.resultFile, report);
  fs.rmSync(files.requestFile, { force: true });
  return report;
}

function readPendingResult(root = ROOT, botName = "main") {
  const report = readJson(getFiles(root).resultFile);
  if (!report || String(report.botName || "main") !== String(botName || "main")) return null;
  if (!Number.isFinite(Number(report.completedAt)) ||
      Date.now() - Number(report.completedAt) > RESULT_TTL_MS) return null;
  return report;
}

function clearPendingResult(root = ROOT, reportId = "") {
  const filePath = getFiles(root).resultFile;
  const current = readJson(filePath);
  if (!current || !reportId || current.id !== reportId) return false;
  fs.rmSync(filePath, { force: true });
  return true;
}

function formatUpdateReport(report = {}) {
  const version = value => "v" + String(value || "unknown").replace(/^v/i, "");
  const oldVersion = version(report.oldVersion);
  const newVersion = version(report.newVersion);
  const oldSha = String(report.oldSha || "").slice(0, 7) || "unknown";
  const newSha = String(report.newSha || "").slice(0, 7) || "unknown";

  if (report.status !== "success") {
    return [
      "❌ CẬP NHẬT JOHNTRAN-JS THẤT BẠI",
      "Phiên bản hiện tại: " + newVersion,
      "Commit hiện tại: " + newSha,
      report.error ? "Lý do: " + String(report.error).slice(0, 450) : "Updater không hoàn tất.",
      "Bot đã khởi động lại bằng mã nguồn hiện tại."
    ].join("\n");
  }

  if (report.updated !== true) {
    return [
      "✅ JOHNTRAN-JS ĐÃ Ở BẢN MỚI NHẤT",
      "Phiên bản: " + newVersion,
      "Commit: " + newSha,
      "Không có mã nguồn mới cần tải."
    ].join("\n");
  }

  const versionLine = oldVersion === newVersion
    ? "Phiên bản ứng dụng: " + newVersion + " (số phiên bản release không đổi)"
    : "Phiên bản: " + oldVersion + " → " + newVersion;

  return [
    "✅ CẬP NHẬT JOHNTRAN-JS THÀNH CÔNG",
    versionLine,
    "Commit: " + oldSha + " → " + newSha,
    "Số file thay đổi: " + Math.max(0, Number(report.changedFiles) || 0),
    "Bot đã khởi động lại bằng mã nguồn mới."
  ].join("\n");
}

module.exports = {
  getFiles,
  writeUpdateRequest,
  readUpdateRequest,
  clearUpdateRequest,
  completeUpdate,
  readPendingResult,
  clearPendingResult,
  formatUpdateReport
};
