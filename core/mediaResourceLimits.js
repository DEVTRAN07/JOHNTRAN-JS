"use strict";

const os = require("node:os");

function boundedInteger(value, fallback, min = 1, max = 4) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) return fallback;
  return Math.min(max, parsed);
}

function getAvailableCpuCount() {
  try {
    const available = typeof os.availableParallelism === "function"
      ? os.availableParallelism()
      : os.cpus()?.length;
    return Math.max(1, Math.floor(Number(available) || 1));
  } catch {
    return 1;
  }
}

function resolveFfmpegThreads(env = process.env) {
  return boundedInteger(env.JT_FFMPEG_THREADS, 1, 1, 4);
}

function resolveHeavyMediaConcurrency(cpuCount = getAvailableCpuCount()) {
  const cpus = Math.max(1, Math.floor(Number(cpuCount) || 1));
  // Leave at least one logical CPU available for the WebSocket listener,
  // command handlers and Zalo response processing.
  return cpus <= 2 ? 1 : 2;
}

const FFMPEG_THREADS = resolveFfmpegThreads();

module.exports = {
  FFMPEG_THREADS,
  getAvailableCpuCount,
  resolveFfmpegThreads,
  resolveHeavyMediaConcurrency
};
