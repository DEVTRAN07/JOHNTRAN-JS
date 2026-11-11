"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const NATIVE_DIR = path.resolve(__dirname);
const CRATES = [
  { name: "sticker-rs", addon: "sticker_rs.node" },
  { name: "canvas-rs", addon: "canvas_rs.node" },
  { name: "ffmpeg-rs", addon: "ffmpeg_rs.node" },
];

function which(cmd) {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.status !== 0) {
    throw new Error("command failed: " + cmd + " " + args.join(" ") + " (exit " + res.status + ")");
  }
  return res;
}

function libExt() {
  switch (process.platform) {
    case "darwin": return "dylib";
    case "win32": return "dll";
    default: return "so";
  }
}

function main() {
  run("cargo", ["build", "--release"], { cwd: NATIVE_DIR });
  for (const crate of CRATES) {
    const crateDir = path.join(NATIVE_DIR, crate.name);
    const addonPath = path.join(crateDir, crate.addon);
    const targetDir = path.join(NATIVE_DIR, "target", "release");
    const libName = "lib" + crate.name.replace(/-/g, "_") + "." + libExt();
    const libPath = path.join(targetDir, libName);
    let built = false;
    if (which("napi")) {
      try {
        run("napi", ["build", "--release"], { cwd: crateDir });
        built = true;
      } catch (err) {
        console.warn("napi build failed for " + crate.name + ": " + err.message + "; falling back to cargo artifact copy");
      }
    }
    if (!built) {
      if (!fs.existsSync(libPath)) {
        throw new Error("expected native library not found: " + libPath);
      }
      fs.copyFileSync(libPath, addonPath);
      console.log("copied " + libPath + " -> " + addonPath);
    }
  }
  console.log("Native build complete.");
}

main();
