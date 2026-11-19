"use strict";

const { performance } = require("node:perf_hooks");

const MAX_HOSTS = 24;
const MAX_SAMPLES_PER_HOST = 200;

function positiveInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) return fallback;
  return Math.min(max, parsed);
}

function resolveTransportOptions(env = process.env, overrides = {}) {
  const keepAliveTimeoutMs = positiveInt(
    overrides.keepAliveTimeoutMs ?? env.JT_ZALO_HTTP_KEEPALIVE_MS,
    60_000,
    1_000,
    10 * 60_000
  );
  const keepAliveMaxTimeoutMs = positiveInt(
    overrides.keepAliveMaxTimeoutMs ?? env.JT_ZALO_HTTP_KEEPALIVE_MAX_MS,
    Math.max(keepAliveTimeoutMs, 120_000),
    keepAliveTimeoutMs,
    10 * 60_000
  );
  const connections = positiveInt(
    overrides.connections ?? env.JT_ZALO_HTTP_CONNECTIONS,
    8,
    1,
    32
  );
  const connectTimeoutMs = positiveInt(
    overrides.connectTimeoutMs ?? env.JT_ZALO_HTTP_CONNECT_TIMEOUT_MS,
    10_000,
    1_000,
    60_000
  );

  return {
    connections,
    pipelining: 1,
    keepAliveTimeout: keepAliveTimeoutMs,
    keepAliveMaxTimeout: keepAliveMaxTimeoutMs,
    keepAliveTimeoutThreshold: 1_000,
    connect: {
      timeout: connectTimeoutMs,
      keepAlive: true
    }
  };
}

function readRequestHost(input) {
  try {
    const raw = typeof input === "string" || input instanceof URL
      ? input
      : input?.url;
    return new URL(raw).hostname.toLowerCase().slice(0, 120);
  } catch {
    return "unknown";
  }
}

function createFetchMetrics(options = {}) {
  const maxHosts = positiveInt(options.maxHosts, MAX_HOSTS, 1, 128);
  const maxSamples = positiveInt(options.maxSamples, MAX_SAMPLES_PER_HOST, 10, 2_000);
  const hosts = new Map();
  let total = 0;
  let failed = 0;

  function record(hostname, elapsedMs, status = 0, error = false) {
    const host = String(hostname || "unknown").slice(0, 120);
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    let entry = hosts.get(host);

    if (!entry) {
      if (hosts.size >= maxHosts) {
        const oldest = hosts.keys().next().value;
        if (oldest !== undefined) hosts.delete(oldest);
      }
      entry = { count: 0, failed: 0, samples: [], statuses: Object.create(null) };
      hosts.set(host, entry);
    } else {
      hosts.delete(host);
      hosts.set(host, entry);
    }

    entry.count++;
    entry.samples.push(elapsed);
    if (entry.samples.length > maxSamples) entry.samples.shift();
    const code = Number(status) || 0;
    const statusKey = error ? "network_error" : String(code || "no_status");
    entry.statuses[statusKey] = (entry.statuses[statusKey] || 0) + 1;
    if (error || code >= 400) {
      entry.failed++;
      failed++;
    }
    total++;
  }

  function summarize(host, entry) {
    const sorted = [...entry.samples].sort((a, b) => a - b);
    const percentile = ratio => sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
      : 0;
    const sum = entry.samples.reduce((value, sample) => value + sample, 0);

    return {
      host,
      count: entry.count,
      failed: entry.failed,
      avgMs: Number((entry.samples.length ? sum / entry.samples.length : 0).toFixed(2)),
      p50Ms: Number(percentile(0.5).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
      maxMs: Number((sorted.at(-1) || 0).toFixed(2)),
      statuses: { ...entry.statuses }
    };
  }

  function stats(limit = 8) {
    const byHost = [...hosts.entries()]
      .map(([host, entry]) => summarize(host, entry))
      .sort((a, b) => b.p95Ms - a.p95Ms || b.avgMs - a.avgMs)
      .slice(0, Math.max(0, Number(limit) || 0));
    return {
      count: total,
      failed,
      hostsTracked: hosts.size,
      byHost
    };
  }

  return { record, stats };
}

let installed = false;
let nativeFetch = null;
let trackedFetch = null;
let previousDispatcher = null;
let httpAgent = null;
let activeOptions = null;
const fetchMetrics = createFetchMetrics();

function installZaloHttpTransport(options = {}) {
  if (installed) {
    return { installed: true, options: activeOptions, stats: fetchMetrics.stats() };
  }
  if (typeof globalThis.fetch !== "function") {
    throw new Error("Node.js global fetch is not available");
  }

  const { Agent, getGlobalDispatcher, setGlobalDispatcher } = require("undici");
  activeOptions = resolveTransportOptions(process.env, options);
  previousDispatcher = getGlobalDispatcher();
  nativeFetch = globalThis.fetch.bind(globalThis);

  // Node's default Undici idle keep-alive timeout is 4 seconds. A Zalo bot
  // often receives commands farther apart than that, which forces fresh TCP/TLS
  // handshakes. Keep a small bounded pool warm for up to one minute instead.
  httpAgent = new Agent(activeOptions);
  setGlobalDispatcher(httpAgent);

  trackedFetch = function trackedZaloFetch(input, init) {
    const host = readRequestHost(input);
    const startedAt = performance.now();

    let request;
    try {
      request = nativeFetch(input, init);
    } catch (error) {
      fetchMetrics.record(host, performance.now() - startedAt, 0, true);
      throw error;
    }

    return Promise.resolve(request).then(
      response => {
        fetchMetrics.record(host, performance.now() - startedAt, response?.status || 0, false);
        return response;
      },
      error => {
        fetchMetrics.record(host, performance.now() - startedAt, 0, true);
        throw error;
      }
    );
  };

  globalThis.fetch = trackedFetch;
  installed = true;

  return {
    installed: true,
    options: activeOptions,
    stats: fetchMetrics.stats()
  };
}

async function closeZaloHttpTransport() {
  if (!installed) return false;

  const { getGlobalDispatcher, setGlobalDispatcher } = require("undici");
  if (globalThis.fetch === trackedFetch && nativeFetch) globalThis.fetch = nativeFetch;
  if (getGlobalDispatcher() === httpAgent && previousDispatcher) {
    setGlobalDispatcher(previousDispatcher);
  }
  try {
    await httpAgent?.close?.();
  } finally {
    installed = false;
    nativeFetch = null;
    trackedFetch = null;
    previousDispatcher = null;
    httpAgent = null;
    activeOptions = null;
  }
  return true;
}

function getZaloHttpTransportStats() {
  return {
    enabled: installed,
    options: activeOptions ? {
      connections: activeOptions.connections,
      keepAliveTimeoutMs: activeOptions.keepAliveTimeout,
      keepAliveMaxTimeoutMs: activeOptions.keepAliveMaxTimeout,
      connectTimeoutMs: activeOptions.connect.timeout
    } : null,
    ...fetchMetrics.stats(8)
  };
}

module.exports = {
  installZaloHttpTransport,
  closeZaloHttpTransport,
  getZaloHttpTransportStats,
  resolveTransportOptions,
  createFetchMetrics,
  readRequestHost
};
