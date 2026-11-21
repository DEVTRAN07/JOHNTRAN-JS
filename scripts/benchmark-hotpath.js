"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const folderMenu = require("../core/runtime/folderMenu");
const { createAdminGroupsStore } = require("../core/runtime/adminGroups");
const { SlidingWindowLimiter, getNativeDiagnostics } = require("../core/runtime/rateLimiter");

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

function benchmarkRateLimiter() {
  const previous = process.env.JT_RUST_RATE_LIMITER;
  const iterations = 100000;
  const users = 1000;
  const trials = 3;

  function run(useRust) {
    if (useRust) process.env.JT_RUST_RATE_LIMITER = "1";
    else process.env.JT_RUST_RATE_LIMITER = "0";

    const samples = [];
    let nativeActive = false;

    for (let trial = 0; trial < trials + 1; trial++) {
      const limiter = new SlidingWindowLimiter({
        windowMs: 60000,
        max: 2000,
        maxKeys: users + 100
      });
      nativeActive = Boolean(limiter._native);
      const started = performance.now();
      for (let index = 0; index < iterations; index++) {
        limiter.allow("user-" + (index % users), 1000000 + index);
      }
      const elapsed = performance.now() - started;
      if (trial > 0) samples.push(elapsed);
      limiter.clear();
    }

    const sorted = samples.slice().sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return {
      iterations,
      trials,
      nativeActive,
      medianTotalMs: Number(medianMs.toFixed(2)),
      avgUs: Number((medianMs * 1000 / iterations).toFixed(3))
    };
  }

  try {
    if (!getNativeDiagnostics().loaded) {
      return {
        available: false,
        reason: "Rust domain-core addon is not built",
        javascript: run(false)
      };
    }

    const javascript = run(false);
    const rust = run(true);
    return {
      available: true,
      javascript,
      rust,
      speedup: Number((javascript.avgUs / Math.max(rust.avgUs, 0.001)).toFixed(2)),
      note: "Synthetic local limiter throughput only; this does not include Zalo event or network latency."
    };
  } finally {
    if (previous === undefined) delete process.env.JT_RUST_RATE_LIMITER;
    else process.env.JT_RUST_RATE_LIMITER = previous;
  }
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

async function benchmarkTopchatCommandFilter() {
  const counter = require("../plugins/events/topchatCounter");
  const { ThreadType } = require("zalo-client");
  const threadId = "hotpath-command-filter-benchmark";
  global.config = { ...(global.config || {}), prefix: "/" };
  const threadRecord = {
    threadId,
    data: { prefix: "/", bot_enabled: true }
  };
  const Threads = {
    getCachedData() { return threadRecord; },
    async getData() { return threadRecord; }
  };
  const event = {
    type: ThreadType.Group,
    threadId,
    isSelf: false,
    data: {
      uidFrom: "benchmark-user",
      dName: "Benchmark",
      cliMsgId: "benchmark-command",
      content: "/menu",
      msgType: "text",
      ts: String(Date.now())
    }
  };
  const iterations = 500;

  // Baseline reproduces the old listener path: diagnostic snapshot allocation,
  // setImmediate, then a TopChat async handler that reads the same cache and
  // rejects the prefixed command before queueing a write.
  const legacyStartedAt = performance.now();
  for (let i = 0; i < iterations; i++) {
    counter.observeIncomingEvent(event);
    await new Promise((resolve, reject) => {
      setImmediate(() => {
        counter.run({ event, Threads }).then(resolve, reject);
      });
    });
  }
  const legacyMs = performance.now() - legacyStartedAt;

  // Fast path keeps the same event/rejected counters but does not schedule the
  // no-op TopChat Promise or repeat the group-cache lookup.
  const fastStartedAt = performance.now();
  for (let i = 0; i < iterations; i++) {
    counter.observeIncomingEvent(event, { snapshot: false });
    counter.observeRejectedCommand(event);
  }
  const fastMs = performance.now() - fastStartedAt;

  return {
    iterations,
    legacyDeferredNoop: {
      totalMs: Number(legacyMs.toFixed(2)),
      avgUs: Number((legacyMs * 1000 / iterations).toFixed(3))
    },
    directDiagnosticFastPath: {
      totalMs: Number(fastMs.toFixed(2)),
      avgUs: Number((fastMs * 1000 / iterations).toFixed(3))
    },
    speedup: Number((legacyMs / Math.max(fastMs, 0.001)).toFixed(1))
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

async function main() {
  const report = {
    benchmark: "JOHNTRAN-JS hot-path microbenchmark",
    node: process.version,
    note: "Synthetic in-process measurements only; Zalo network/API latency is not included.",
    rateLimiter: benchmarkRateLimiter(),
    menu: benchmarkMenuLookup(),
    adminGroups: benchmarkAdminGroupRead(),
    topchatCommandFilter: await benchmarkTopchatCommandFilter()
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error("[benchmark:hotpath] failed:", error?.stack || error);
  process.exitCode = 1;
});
