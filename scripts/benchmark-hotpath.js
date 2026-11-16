"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const folderMenu = require("../core/runtime/folderMenu");
const { createAdminGroupsStore } = require("../core/runtime/adminGroups");

function measure(label, iterations, operation) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    operation();
    samples.push(performance.now() - started);
  }
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  return {
    label,
    iterations,
    totalMs: Number(totalMs.toFixed(2)),
    avgUs: Number((totalMs * 1000 / iterations).toFixed(3))
  };
}

function makeCommand(name, category, role = 0) {
  return { config: { name, category, role, usage: name, description: name } };
}

function benchmarkMenuLookup() {
  global.users = { admin: ["bench-admin"], support: ["bench-support"] };
  const categories = ["Tiện ích", "Hệ thống", "Nhóm", "Nhạc", "Game", "Giải trí", "AI"];
  const commands = new Map();
  for (let i = 0; i < 3000; i++) {
    const name = i === 0 ? "noitu" : "benchcmd" + i;
    const category = i === 0 ? "Game" : categories[i % categories.length];
    commands.set(name, makeCommand(name, category, i % 17 === 0 ? 2 : i % 5 === 0 ? 1 : 0));
  }

  // Baseline: the former resolver rebuilt and sorted every visible group.
  const baseline = measure("menu-index-build (baseline)", 250, () => {
    folderMenu.collectMenuGroups(commands, "bench-admin");
  });

  folderMenu.invalidateMenuGroupIndex(commands);
  folderMenu.resolveMenuGroup(commands, "bench-admin", "game"); // warm once
  const cached = measure("menu-shortcut-resolve (cached)", 20000, () => {
    folderMenu.resolveMenuGroup(commands, "bench-admin", "game");
  });

  return {
    commands: commands.size,
    baseline,
    cached,
    speedup: Number((baseline.avgUs / Math.max(cached.avgUs, 0.001)).toFixed(1))
  };
}

function benchmarkAdminGroupRead() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-hotpath-bench-"));
  const filePath = path.join(dir, "bot_admin_groups.json");
  const groups = Array.from({ length: 500 }, (_, index) => "group-" + index);
  fs.writeFileSync(filePath, JSON.stringify(groups), "utf8");

  try {
    const store = createAdminGroupsStore({ filePath, cacheTtlMs: 5000 });
    const raw = measure("admin-groups-read (raw JSON)", 2000, () => {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
    });
    const cached = measure("admin-groups-read (cached)", 20000, () => {
      store.read();
    });
    return {
      groups: groups.length,
      raw,
      cached,
      diskReadsDuringCachedLoop: store.getStats().diskReads,
      speedup: Number((raw.avgUs / Math.max(cached.avgUs, 0.001)).toFixed(1))
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const report = {
  benchmark: "JOHNTRAN-JS hot-path microbenchmark",
  node: process.version,
  note: "Synthetic in-process measurements only; Zalo network/API latency is not included.",
  menu: benchmarkMenuLookup(),
  adminGroups: benchmarkAdminGroupRead()
};

console.log(JSON.stringify(report, null, 2));
