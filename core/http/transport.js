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
  // Reserve an independent pool for text replies. Background group/profile
  // lookups must not consume every socket needed to answer a chat command.
  const replyConnections = positiveInt(
    overrides.replyConnections ?? env.JT_ZALO_HTTP_REPLY_CONNECTIONS,
    4,
    1,
    16
  );

  return {
    connections,
    replyConnections,
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

function readRequestUrl(input) {
  try {
    const raw = typeof input === "string" || input instanceof URL
      ? input
      : input?.url;
    return new URL(raw);
  } catch {
    return null;
  }
}

function readRequestHost(input) {
  return readRequestUrl(input)?.hostname.toLowerCase().slice(0, 120) || "unknown";
}

// Only plain-text send endpoints receive reserved connections. File uploads,
// profile reads, group-info lookups, reactions and other background API calls
// stay on the shared pool.
function isPriorityReplyRequest(input, init = {}) {
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (method !== "POST") return false;
  const url = readRequestUrl(input);
  if (!url) return false;
  return /\\/api\\/(?:group\\/(?:sendmsg|mention|quote)|message\\/(?:sms|quote))\\/?$/i.test(url.pathname);
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
let replyAgent = null;
let activeOptions = null;
const fetchMetrics = createFetchMetrics();
const laneMetrics = {
  reply: { count: 0, failed: 0 },
  shared: { count: 0, failed: 0 }
};

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

  // Node's default Undici idle keep-alive timeout is 4 seconds. Keep the
  // shared pool warm, and reserve a second independent pool for command replies.
  // An Agent owns its own per-origin connection limits, so a burst of background
  // getGroupInfo/getAllFriends requests cannot occupy the reply pool.
  const { replyConnections, ...sharedAgentOptions } = activeOptions;
  httpAgent = new Agent(sharedAgentOptions);
  replyAgent = new Agent({ ...sharedAgentOptions, connections: replyConnections });
  setGlobalDispatcher(httpAgent);

  trackedFetch = function trackedZaloFetch(input, init) {
    const host = readRequestHost(input);
    const startedAt = performance.now();
    const priorityReply = isPriorityReplyRequest(input, init);
    const lane = priorityReply ? laneMetrics.reply : laneMetrics.shared;
    lane.count++;
    const requestOptions = priorityReply
      ? { ...(init || {}), dispatcher: replyAgent }
      : init;

    let request;
    try {
      request = nativeFetch(input, requestOptions);
    } catch (error) {
      lane.failed++;
      fetchMetrics.record(host, performance.now() - startedAt, 0, true);
      throw error;
    }

    return Promise.resolve(request).then(
      response => {
        if (!response?.ok) lane.failed++;
        fetchMetrics.record(host, performance.now() - startedAt, response?.status || 0, false);
        return response;
      },
      error => {
        lane.failed++;
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
    await Promise.all([
      httpAgent?.close?.(),
      replyAgent?.close?.()
    ]);
  } finally {
    installed = false;
    nativeFetch = null;
    trackedFetch = null;
    previousDispatcher = null;
    httpAgent = null;
    replyAgent = null;
    activeOptions = null;
  }
  return true;
}

function getZaloHttpTransportStats() {
  return {
    enabled: installed,
    options: activeOptions ? {
      connections: activeOptions.connections,
      replyConnections: activeOptions.replyConnections,
      keepAliveTimeoutMs: activeOptions.keepAliveTimeout,
      keepAliveMaxTimeoutMs: activeOptions.keepAliveMaxTimeout,
      connectTimeoutMs: activeOptions.connect.timeout
    } : null,
    lanes: {
      reply: { ...laneMetrics.reply },
      shared: { ...laneMetrics.shared }
    },
    ...fetchMetrics.stats(8)
  };
}

module.exports = {
  installZaloHttpTransport,
  closeZaloHttpTransport,
  getZaloHttpTransportStats,
  resolveTransportOptions,
  createFetchMetrics,
  readRequestUrl,
  readRequestHost,
  isPriorityReplyRequest
};
