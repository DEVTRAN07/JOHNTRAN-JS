"use strict";

const os = require("os");
const fs = require("fs");

const SAMPLE_INTERVAL_MS = 1000;
const DISK_TTL_MS = 30000;

function cpuSnapshot() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function networkSnapshot() {
  try {
    const raw = fs.readFileSync("/proc/net/dev", "utf8");
    let rx = 0;
    let tx = 0;
    for (const line of raw.trim().split("\n").slice(2)) {
      const [name, values] = line.trim().split(":");
      if (!values || name.trim() === "lo") continue;
      const fields = values.trim().split(/\s+/).map(Number);
      rx += fields[0] || 0;
      tx += fields[8] || 0;
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

function baseSnapshot() {
  const memory = os.totalmem();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model || "Unknown",
    cpuCores: os.cpus().length,
    cpuPercent: 0,
    ramTotal: memory,
    ramUsed: memory - os.freemem(),
    diskTotal: 0,
    diskUsed: 0,
    rxKBs: null,
    txKBs: null,
    processRam: process.memoryUsage().rss,
    node: process.version,
    sampledAt: Date.now()
  };
}

let snapshot = baseSnapshot();
let previousCpu = cpuSnapshot();
let previousNetwork = networkSnapshot();
let previousAt = Date.now();
let lastDiskAt = 0;
let diskFlight = null;

async function refreshDisk() {
  if (diskFlight) return diskFlight;
  if (Date.now() - lastDiskAt < DISK_TTL_MS) return;

  diskFlight = (async () => {
    try {
      if (typeof fs.promises.statfs !== "function") return;
      const stats = await fs.promises.statfs("/");
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bfree) * Number(stats.bsize);
      if (Number.isFinite(total) && total > 0 && Number.isFinite(free)) {
        snapshot = {
          ...snapshot,
          diskTotal: total,
          diskUsed: Math.max(0, total - free)
        };
        lastDiskAt = Date.now();
      }
    } catch {
      // Disk metrics are optional; never hold up command responses.
    }
  })().finally(() => {
    diskFlight = null;
  });

  return diskFlight;
}

function refreshSnapshot(now = Date.now()) {
  const currentCpu = cpuSnapshot();
  const currentNetwork = networkSnapshot();
  const elapsedMs = Math.max(1, now - previousAt);
  let total = 0;
  let idle = 0;

  for (let index = 0; index < Math.min(previousCpu.length, currentCpu.length); index++) {
    const before = previousCpu[index];
    const after = currentCpu[index];
    for (const key of Object.keys(after)) {
      total += Math.max(0, (after[key] || 0) - (before[key] || 0));
    }
    idle += Math.max(0, (after.idle || 0) - (before.idle || 0));
  }

  const memory = os.totalmem();
  const rxKBs = previousNetwork && currentNetwork
    ? Math.max(0, ((currentNetwork.rx - previousNetwork.rx) / 1024) * 1000 / elapsedMs)
    : snapshot.rxKBs;
  const txKBs = previousNetwork && currentNetwork
    ? Math.max(0, ((currentNetwork.tx - previousNetwork.tx) / 1024) * 1000 / elapsedMs)
    : snapshot.txKBs;

  snapshot = {
    ...snapshot,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model || snapshot.cpuModel,
    cpuCores: currentCpu.length,
    cpuPercent: total > 0 ? Math.round(Math.max(0, Math.min(100, 100 * (1 - idle / total)))) : snapshot.cpuPercent,
    ramTotal: memory,
    ramUsed: memory - os.freemem(),
    rxKBs,
    txKBs,
    processRam: process.memoryUsage().rss,
    node: process.version,
    sampledAt: now
  };

  previousCpu = currentCpu;
  previousNetwork = currentNetwork;
  previousAt = now;

  // Refresh slower disk data in the background (30-second TTL).
  void refreshDisk();
  return snapshot;
}

// Maintain a rolling snapshot while the bot is idle, not while a command waits.
const sampler = setInterval(() => refreshSnapshot(), SAMPLE_INTERVAL_MS);
sampler.unref?.();
void refreshDisk();

function collectDeviceMetrics() {
  if (Date.now() - snapshot.sampledAt >= SAMPLE_INTERVAL_MS) {
    refreshSnapshot();
  }
  // Return a copy immediately; CPU/network/disk sampling never waits on timers
  // or child processes in a command handler.
  return { ...snapshot };
}

module.exports = {
  collectDeviceMetrics,
  refreshSnapshot,
  refreshDisk,
  SAMPLE_INTERVAL_MS,
  DISK_TTL_MS
};
