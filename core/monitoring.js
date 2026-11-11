'use strict';

/**
 * Prometheus monitoring module (prom-client).
 *
 * Exposes metrics, Express /metrics endpoint, and middleware for
 * automatic command latency tracking.
 *
 * NOTE: requires `prom-client` and `express`.
 *   npm i prom-client express
 */

const client = require('prom-client');
const { Router } = require('express');

// Dedicated registry so tests/consumers can isolate if needed.
const register = new client.Registry();

// Default Node/process metrics (memory, CPU, event loop lag, GC, etc.).
client.collectDefaultMetrics({ register, prefix: 'johntran_' });

// --- Custom metrics ---------------------------------------------------------

// HTTP request duration (seconds), labeled by method/route/status.
const httpRequestDuration = new client.Histogram({
  name: 'johntran_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Command latency (seconds), labeled by command name and outcome.
const commandLatency = new client.Histogram({
  name: 'johntran_command_latency_seconds',
  help: 'Bot command execution latency in seconds',
  labelNames: ['command', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

// WebSocket reconnects, labeled by socket/service name.
const websocketReconnects = new client.Counter({
  name: 'johntran_websocket_reconnects_total',
  help: 'Total number of WebSocket reconnect attempts',
  labelNames: ['socket'],
  registers: [register],
});

// Worker pool queue depth and throughput.
const workerPoolQueueSize = new client.Gauge({
  name: 'johntran_worker_pool_queue_size',
  help: 'Current number of jobs waiting in the worker pool queue',
  labelNames: ['pool'],
  registers: [register],
});

const workerPoolQueuedTotal = new client.Counter({
  name: 'johntran_worker_pool_jobs_queued_total',
  help: 'Total jobs enqueued to the worker pool',
  labelNames: ['pool'],
  registers: [register],
});

const workerPoolCompletedTotal = new client.Counter({
  name: 'johntran_worker_pool_jobs_completed_total',
  help: 'Total jobs completed by the worker pool',
  labelNames: ['pool', 'status'],
  registers: [register],
});

// Explicit memory usage gauges (in addition to default process metrics).
const memoryUsageBytes = new client.Gauge({
  name: 'johntran_memory_usage_bytes',
  help: 'Process memory usage in bytes by type',
  labelNames: ['type'],
  registers: [register],
  collect() {
    const mem = process.memoryUsage();
    this.set({ type: 'rss' }, mem.rss);
    this.set({ type: 'heap_total' }, mem.heapTotal);
    this.set({ type: 'heap_used' }, mem.heapUsed);
    this.set({ type: 'external' }, mem.external);
    if (typeof mem.arrayBuffers === 'number') {
      this.set({ type: 'array_buffers' }, mem.arrayBuffers);
    }
  },
});

// Cache hit/miss counters.
const cacheRequestsTotal = new client.Counter({
  name: 'johntran_cache_requests_total',
  help: 'Total cache lookups by cache name and result',
  labelNames: ['cache', 'result'],
  registers: [register],
});

// Database latency (seconds).
const dbLatency = new client.Histogram({
  name: 'johntran_db_latency_seconds',
  help: 'Database operation latency in seconds',
  labelNames: ['operation', 'table', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// External API latency (seconds).
const externalApiLatency = new client.Histogram({
  name: 'johntran_external_api_latency_seconds',
  help: 'External API call latency in seconds',
  labelNames: ['service', 'endpoint', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

// Error counters.
const errorsTotal = new client.Counter({
  name: 'johntran_errors_total',
  help: 'Total errors by type and source',
  labelNames: ['type', 'source'],
  registers: [register],
});

// --- Helpers ----------------------------------------------------------------

function normalizeRoute(req) {
  if (req.route && req.route.path) return req.route.path;
  if (req.baseUrl) return (req.baseUrl + (req.path || '')) || req.baseUrl;
  return req.path || 'unknown';
}

function recordCache(cache, hit) {
  cacheRequestsTotal.inc({ cache: cache || 'default', result: hit ? 'hit' : 'miss' });
}

function recordWebsocketReconnect(socket) {
  websocketReconnects.inc({ socket: socket || 'default' });
}

function setWorkerQueueSize(pool, size) {
  workerPoolQueueSize.set({ pool: pool || 'default' }, Number(size) || 0);
}

function observeWorkerJobQueued(pool) {
  workerPoolQueuedTotal.inc({ pool: pool || 'default' });
}

function observeWorkerJobCompleted(pool, status) {
  workerPoolCompletedTotal.inc({ pool: pool || 'default', status: status || 'success' });
}

function observeDbLatency(operation, table, seconds, status) {
  dbLatency.observe({ operation: operation || 'unknown', table: table || 'unknown', status: status || 'success' }, seconds);
}

function observeExternalApiLatency(service, endpoint, seconds, status) {
  externalApiLatency.observe({ service: service || 'unknown', endpoint: endpoint || 'unknown', status: status || 'success' }, seconds);
}

function recordError(type, source) {
  errorsTotal.inc({ type: type || 'error', source: source || 'unknown' });
}

async function timeDb(operation, table, fn) {
  const end = dbLatency.startTimer({ operation: operation || 'unknown', table: table || 'unknown' });
  try {
    const result = await fn();
    end({ status: 'success' });
    return result;
  } catch (err) {
    end({ status: 'error' });
    recordError('db', table || operation || 'unknown');
    throw err;
  }
}

async function timeExternalApi(service, endpoint, fn) {
  const end = externalApiLatency.startTimer({ service: service || 'unknown', endpoint: endpoint || 'unknown' });
  try {
    const result = await fn();
    end({ status: 'success' });
    return result;
  } catch (err) {
    end({ status: 'error' });
    recordError('external_api', service || 'unknown');
    throw err;
  }
}

// --- Middleware & endpoint --------------------------------------------------

function httpMetricsMiddleware() {
  return (req, res, next) => {
    const end = httpRequestDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      end({ route: normalizeRoute(req), status_code: String(res.statusCode) });
    });
    next();
  };
}

function trackCommandLatency(commandName, handler) {
  return async function trackedCommand() {
    const stop = commandLatency.startTimer({ command: commandName || 'unknown' });
    try {
      const result = await handler.apply(this, arguments);
      stop({ status: 'success' });
      return result;
    } catch (err) {
      stop({ status: 'error' });
      recordError('command', commandName || 'unknown');
      throw err;
    }
  };
}

function commandLatencyTimer(commandName) {
  const end = commandLatency.startTimer({ command: commandName || 'unknown' });
  return (status) => end({ status: status || 'success' });
}

function metricsEndpoint() {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      recordError('metrics_endpoint', 'monitoring');
      res.status(500).end(err && err.message ? err.message : 'metrics error');
    }
  });
  return router;
}

function installMonitoring(app, options) {
  options = options || {};
  if (!app || typeof app.use !== 'function') return app;
  if (options.trackHttp !== false) {
    app.use(httpMetricsMiddleware());
  }
  const path = options.path || '/metrics';
  app.get(path, async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      recordError('metrics_endpoint', 'monitoring');
      res.status(500).end(err && err.message ? err.message : 'metrics error');
    }
  });
  return app;
}

/*
 * ---------------------------------------------------------------------------
 * Prometheus alert rules (examples) — add to your Prometheus rules config:
 * ---------------------------------------------------------------------------
 *
 * groups:
 * - name: johntran-bot
 *   rules:
 *   - alert: HighCommandLatencyP95
 *     expr: histogram_quantile(0.95, sum(rate(johntran_command_latency_seconds_bucket[5m])) by (le, command)) > 2
 *     for: 10m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "High command latency (p95 > 2s)"
 *       description: "Command {{ .command }} p95 latency is {{  }}s."
 *
 *   - alert: HighHttpLatencyP95
 *     expr: histogram_quantile(0.95, sum(rate(johntran_http_request_duration_seconds_bucket[5m])) by (le, route)) > 1
 *     for: 10m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "High HTTP latency (p95 > 1s)"
 *       description: "Route {{ .route }} p95 latency is {{  }}s."
 *
 *   - alert: CommandErrorRateHigh
 *     expr: sum(rate(johntran_errors_total{type="command"}[5m])) / clamp_min(sum(rate(johntran_command_latency_seconds_count[5m])), 1) > 0.05
 *     for: 5m
 *     labels: { severity: critical }
 *     annotations:
 *       summary: "Command error rate > 5%"
 *
 *   - alert: FrequentWebsocketReconnects
 *     expr: increase(johntran_websocket_reconnects_total[10m]) > 5
 *     for: 0m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "WebSocket reconnecting frequently"
 *       description: "Socket {{ .socket }} reconnected {{  }} times in 10m."
 *
 *   - alert: WorkerPoolQueueBacklog
 *     expr: johntran_worker_pool_queue_size > 100
 *     for: 5m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "Worker pool queue backlog"
 *       description: "Pool {{ .pool }} queue size is {{  }}."
 *
 *   - alert: HighMemoryUsage
 *     expr: johntran_memory_usage_bytes{type="rss"} > 512 * 1024 * 1024
 *     for: 10m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "High RSS memory usage (>512MB)"
 *
 *   - alert: LowCacheHitRate
 *     expr: sum(rate(johntran_cache_requests_total{result="hit"}[10m])) by (cache) / clamp_min(sum(rate(johntran_cache_requests_total[10m])) by (cache), 1) < 0.5
 *     for: 15m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "Low cache hit rate (<50%)"
 *       description: "Cache {{ .cache }} hit rate is {{  | humanizePercentage }}."
 *
 *   - alert: HighDbLatencyP95
 *     expr: histogram_quantile(0.95, sum(rate(johntran_db_latency_seconds_bucket[5m])) by (le, operation, table)) > 0.5
 *     for: 10m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "High DB latency (p95 > 500ms)"
 *
 *   - alert: HighExternalApiLatencyP95
 *     expr: histogram_quantile(0.95, sum(rate(johntran_external_api_latency_seconds_bucket[5m])) by (le, service)) > 5
 *     for: 10m
 *     labels: { severity: warning }
 *     annotations:
 *       summary: "High external API latency (p95 > 5s)"
 *
 *   - alert: ErrorSpike
 *     expr: sum(increase(johntran_errors_total[5m])) by (type, source) > 20
 *     for: 0m
 *     labels: { severity: critical }
 *     annotations:
 *       summary: "Error spike detected"
 *       description: "{{ .type }} errors from {{ .source }}: {{  }} in 5m."
 * ---------------------------------------------------------------------------
 */

module.exports = {
  client,
  register,
  metrics: {
    httpRequestDuration,
    commandLatency,
    websocketReconnects,
    workerPoolQueueSize,
    workerPoolQueuedTotal,
    workerPoolCompletedTotal,
    memoryUsageBytes,
    cacheRequestsTotal,
    dbLatency,
    externalApiLatency,
    errorsTotal,
  },
  metricsEndpoint,
  installMonitoring,
  httpMetricsMiddleware,
  trackCommandLatency,
  commandLatencyTimer,
  recordCache,
  recordWebsocketReconnect,
  setWorkerQueueSize,
  observeWorkerJobQueued,
  observeWorkerJobCompleted,
  observeDbLatency,
  observeExternalApiLatency,
  recordError,
  timeDb,
  timeExternalApi,
};
