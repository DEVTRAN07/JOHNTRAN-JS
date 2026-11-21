"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const NATIVE_DIR = path.resolve(__dirname);
// Only ship the audited production addon. canvas-rs and ffmpeg-rs remain
// prototypes until their build/runtime contracts pass the same CI gate.
const CRATES = [
  { name: "sticker-rs", addon: "sticker_rs.node" },
  { name: "command-core-rs", addon: "command_core_rs.node" },
  { name: "game-core-rs", addon: "game_core_rs.node" },
];

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
    const stem = crate.name.replace(/-/g, "_");
    const libName = (process.platform === "win32" ? "" : "lib") + stem + "." + libExt();
    const libPath = path.join(targetDir, libName);
    if (!fs.existsSync(libPath)) {
      throw new Error("expected native library not found: " + libPath);
    }
    // A napi-rs cdylib exports the Node-API registration symbol directly.
    // Copying the platform library to .node avoids requiring a second
    // platform-detection/build step from the napi CLI.
    fs.copyFileSync(libPath, addonPath);
    console.log("copied " + libPath + " -> " + addonPath);
  }
  // The text-style N-API module is a standalone workspace. Building it alone
  // avoids resolving optional image/audio crates in the legacy native workspace.
  const textStyleDir = path.join(NATIVE_DIR, "text-style-rs");
  run("cargo", ["build", "--manifest-path", path.join(textStyleDir, "Cargo.toml"), "--release"], { cwd: textStyleDir });
  const textStyleLibrary = path.join(textStyleDir, "target", "release", "libtext_style_rs." + libExt());
  const textStyleAddon = path.join(textStyleDir, "text_style_rs.node");
  if (!fs.existsSync(textStyleLibrary)) throw new Error("expected Rust text-style library not found: " + textStyleLibrary);
  fs.copyFileSync(textStyleLibrary, textStyleAddon);
  console.log("copied " + textStyleLibrary + " -> " + textStyleAddon);
  console.log("Native build complete.");
}

main();
