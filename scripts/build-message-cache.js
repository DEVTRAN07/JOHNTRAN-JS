#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(ROOT, "rust", "message-cache", "Cargo.toml");
const CRATE_DIR = path.dirname(MANIFEST);
const BINARY_NAME = process.platform === "win32" ? "jt-message-cache.exe" : "jt-message-cache";
const BUILT_BINARY = path.join(CRATE_DIR, "target", "release", BINARY_NAME);
const OUTPUT_DIR = path.join(ROOT, "native", "bin");
const OUTPUT_BINARY = path.join(OUTPUT_DIR, BINARY_NAME);

function runCargo() {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", [
      "build",
      "--release",
      "--manifest-path",
      MANIFEST
    ], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true
    });

    child.once("error", error => {
      reject(new Error(
        "Không thể chạy Cargo. Hãy cài Rust toolchain rồi chạy lại npm run build:message-cache. " +
        (error?.message || error)
      ));
    });
    child.once("close", code => {
      if (code === 0) resolve();
      else reject(new Error("Cargo build message-cache thất bại (exit code " + code + ")."));
    });
  });
}

async function main() {
  await fs.access(MANIFEST);
  console.log("[message-cache] Đang build Rust sidecar...");
  await runCargo();
  await fs.access(BUILT_BINARY);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.copyFile(BUILT_BINARY, OUTPUT_BINARY);
  if (process.platform !== "win32") {
    await fs.chmod(OUTPUT_BINARY, 0o755);
  }
  console.log("[message-cache] Đã cài binary: " + path.relative(ROOT, OUTPUT_BINARY));
}

if (require.main === module) {
  main().catch(error => {
    console.error("[message-cache] " + (error?.stack || error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  MANIFEST,
  BUILT_BINARY,
  OUTPUT_BINARY
};
