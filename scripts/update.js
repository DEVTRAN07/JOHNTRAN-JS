"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGET_BRANCH = "main";
const TARGET_REPOSITORY = "DEVTRAN07/JOHNTRAN-JS";

function normalizeRemote(remote) {
  let value = String(remote || "").trim();
  if (!value) return "";
  value = value.replace(/^git@github\.com:/i, "https://github.com/");
  value = value.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  return value.replace(/\.git$/i, "").replace(/\/+$/, "");
}

function isTargetRemote(remote) {
  const normalized = normalizeRemote(remote);
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  return Boolean(match &&
    match[1].toLowerCase() === "devtran07" &&
    match[2].toLowerCase() === "johntran-js");
}

function parseAheadBehind(output) {
  const parts = String(output || "").trim().split(/\s+/);
  if (parts.length < 2) throw new Error("Không đọc được trạng thái commit local/remote.");
  const ahead = Number(parts[0]);
  const behind = Number(parts[1]);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) {
    throw new Error("Git trả về số commit ahead/behind không hợp lệ.");
  }
  return { ahead, behind };
}

function hasDependencyChanges(files) {
  // npm ci is required only when the dependency lock changes. package.json-only
  // edits to scripts/metadata do not justify deleting and rebuilding node_modules.
  return (Array.isArray(files) ? files : []).includes("package-lock.json");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...(options.env || {})
    },
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) {
    throw new Error("Không thể chạy " + command + ": " + result.error.message);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(
      command + " " + args.join(" ") + " thất bại (exit " + result.status + ")" +
      (detail ? ":\n" + detail.slice(-5000) : ""));
  }
  return options.inherit ? "" : String(result.stdout || "").trim();
}

function runNpm(args, options = {}) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(npmCommand, args, { ...options, inherit: true });
}

function ensureRepository() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    throw new Error(
      "Thư mục hiện tại chưa phải Git clone (.git không tồn tại). " +
      "Hãy clone repository một lần; updater không thể cập nhật an toàn từ thư mục ZIP.");
  }
  const topLevel = path.resolve(run("git", ["rev-parse", "--show-toplevel"]));
  if (topLevel !== ROOT) {
    throw new Error("Thư mục Git root không trùng thư mục JOHNTRAN-JS hiện tại.");
  }
  const branch = run("git", ["branch", "--show-current"]);
  if (branch !== TARGET_BRANCH) {
    throw new Error(
      "Bot đang ở nhánh \"" + (branch || "detached HEAD") +
      "\". Updater chỉ cập nhật nhánh main và sẽ không tự chuyển nhánh.");
  }
  const remote = run("git", ["remote", "get-url", "origin"]);
  if (!isTargetRemote(remote)) {
    throw new Error("Remote origin không trỏ tới " + TARGET_REPOSITORY + "; đã dừng để tránh cập nhật nhầm repository.");
  }
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty) {
    const entries = dirty.split(/\r?\n/).filter(Boolean);
    const paths = entries.slice(0, 8);
    throw new Error(
      "Có thay đổi local chưa commit. Updater giữ nguyên các file và không ghi đè:\n" +
      paths.join("\n") +
      (entries.length > paths.length ? "\n… còn file khác" : ""));
  }
}

function updateRepository() {
  ensureRepository();
  console.log("[update] Đang kiểm tra origin/main...");
  run("git", ["fetch", "--prune", "origin", "+refs/heads/" + TARGET_BRANCH + ":refs/remotes/origin/" + TARGET_BRANCH]);

  const oldSha = run("git", ["rev-parse", "HEAD"]);
  const remoteSha = run("git", ["rev-parse", "refs/remotes/origin/" + TARGET_BRANCH]);
  const status = parseAheadBehind(
    run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/" + TARGET_BRANCH]));

  if (status.ahead > 0) {
    throw new Error(
      "Nhánh local có " + status.ahead +
      " commit chưa có trên origin/main. Updater không reset hoặc ghi đè commit local.");
  }
  if (status.behind === 0) {
    console.log("[update] Máy đã ở bản mới nhất: " + oldSha.slice(0, 12));
    return { updated: false, oldSha, newSha: oldSha, changedFiles: [] };
  }

  const changedFiles = run("git", ["diff", "--name-only", oldSha + ".." + remoteSha])
    .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  console.log("[update] Có " + status.behind + " commit mới, " + changedFiles.length + " file thay đổi.");
  run("git", ["merge", "--ff-only", "origin/" + TARGET_BRANCH]);
  const newSha = run("git", ["rev-parse", "HEAD"]);

  if (hasDependencyChanges(changedFiles)) {
    console.log("[update] package-lock.json thay đổi — đang đồng bộ dependency bằng npm ci...");
    try {
      runNpm(["ci", "--no-audit", "--no-fund"]);
    } catch (installError) {
      console.error("[update] npm ci lỗi. Đang rollback mã nguồn về " + oldSha.slice(0, 12) + "...");
      try {
        run("git", ["reset", "--hard", oldSha]);
      } catch (rollbackError) {
        throw new Error("npm ci thất bại và rollback mã nguồn cũng lỗi: " + rollbackError.message);
      }
      try {
        runNpm(["ci", "--no-audit", "--no-fund"]);
      } catch (restoreError) {
        console.error("[update] Không khôi phục được node_modules cũ: " + restoreError.message);
      }
      throw new Error("Đã rollback mã nguồn do npm ci thất bại: " + installError.message);
    }
  }

  const stickerRustChanged = changedFiles.some(file => file.startsWith("native/sticker-rs/"));
  if (stickerRustChanged) {
    const cargo = spawnSync("cargo", ["--version"], { cwd: ROOT, stdio: "ignore" });
    const napiCli = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "napi.cmd" : "napi");
    if (cargo.status === 0 && fs.existsSync(napiCli)) {
      try {
        console.log("[update] Đang build sticker Rust addon cho hệ điều hành/kiến trúc hiện tại...");
        runNpm(["run", "build:native"]);
      } catch (error) {
        console.warn("[update] Không build được Rust addon; bot sẽ dùng Canvas/FFmpeg fallback:", error.message);
      }
    } else {
      console.log("[update] Bỏ qua Rust addon (thiếu Cargo hoặc N-API CLI); fallback JS vẫn được giữ.");
    }
  }

  console.log("[update] Cập nhật thành công: " + oldSha.slice(0, 12) + " → " + newSha.slice(0, 12));
  return { updated: true, oldSha, newSha, changedFiles };
}

function main() {
  try {
    updateRepository();
    process.exitCode = 0;
  } catch (error) {
    console.error("[update] ERROR:", error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { normalizeRemote, isTargetRemote, parseAheadBehind, hasDependencyChanges, updateRepository };
