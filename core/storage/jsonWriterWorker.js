"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");

const file = path.resolve(String(workerData?.file || ""));
const tables = Array.isArray(workerData?.tables) ? workerData.tables : [];
const FLUSH_DELAY_MS = Math.max(50, Number(workerData?.flushDelayMs) || 400);
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

let data = {};
let initialized = false;
let startupQueue = [];
let messageChain = Promise.resolve();
let revision = 0;
let persistedRevision = 0;
let flushTimer = null;
let flushPromise = null;
let consecutiveFailures = 0;
let lastError = null;

function send(message) {
  try { parentPort.postMessage(message); } catch { /* parent is shutting down */ }
}

async function initialize() {
  try {
    let parsed = {};
    try {
      const raw = await fs.readFile(file, "utf8");
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Cấu trúc JSON store không hợp lệ trong writer worker");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    data = {};
    for (const name of tables) {
      const value = parsed[name];
      if (value != null && (typeof value !== "object" || Array.isArray(value))) {
        throw new Error("Bảng " + name + " không phải object hợp lệ trong writer worker");
      }
      data[name] = value || {};
    }
    initialized = true;
    send({ type: "ready", ok: true });

    const queued = startupQueue;
    startupQueue = [];
    for (const message of queued) enqueue(message);
  } catch (error) {
    send({ type: "ready", ok: false, error: error?.message || String(error) });
    startupQueue = [];
  }
}

function scheduleFlush(delayMs = FLUSH_DELAY_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushSnapshot().catch(() => {});
  }, Math.max(1, Number(delayMs) || 1));
  flushTimer.unref?.();
}

function reportFlush(ok, snapshotRevision, durationMs, error = null) {
  send({
    type: "flush-status",
    ok,
    sequence: snapshotRevision,
    durationMs: Math.max(0, Number(durationMs) || 0),
    error: error ? String(error.message || error).slice(0, 1000) : null
  });
}

function flushSnapshot() {
  if (flushPromise) return flushPromise;
  if (persistedRevision >= revision) return Promise.resolve(true);

  const snapshotRevision = revision;
  const startedAt = Date.now();
  let serialized;
  try {
    // JSON serialization runs in this worker, never on the Zalo listener thread.
    serialized = JSON.stringify(data, null, 2);
  } catch (error) {
    lastError = error?.message || String(error);
    consecutiveFailures++;
    reportFlush(false, snapshotRevision, Date.now() - startedAt, error);
    scheduleFlush(Math.min(RETRY_BASE_MS * (2 ** (consecutiveFailures - 1)), RETRY_MAX_MS));
    return Promise.reject(error);
  }

  const tempFile = file + "." + process.pid + ".tmp";
  flushPromise = (async () => {
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(tempFile, serialized, "utf8");
      await fs.rename(tempFile, file);
      persistedRevision = Math.max(persistedRevision, snapshotRevision);
      consecutiveFailures = 0;
      lastError = null;
      reportFlush(true, snapshotRevision, Date.now() - startedAt);
      return true;
    } catch (error) {
      lastError = error?.message || String(error);
      consecutiveFailures++;
      try { await fs.unlink(tempFile); } catch { /* best effort */ }
      reportFlush(false, snapshotRevision, Date.now() - startedAt, error);
      scheduleFlush(Math.min(RETRY_BASE_MS * (2 ** (consecutiveFailures - 1)), RETRY_MAX_MS));
      throw error;
    }
  })().finally(() => {
    flushPromise = null;
    // Mutations received while the file write was in flight need a newer snapshot.
    if (revision > persistedRevision && !flushTimer) scheduleFlush();
  });

  return flushPromise;
}

async function flushUntil(targetRevision) {
  const target = Math.max(0, Number(targetRevision) || 0);
  while (persistedRevision < target) {
    await flushSnapshot();
  }
  return persistedRevision;
}

function applyMutation(message) {
  const sequence = Math.max(0, Number(message.sequence) || 0);
  if (sequence <= revision) return;
  const table = String(message.table || "");
  const key = String(message.key ?? "");
  if (!table || !key) throw new Error("JSON writer received an invalid mutation");
  if (!data[table] || typeof data[table] !== "object" || Array.isArray(data[table])) {
    data[table] = {};
  }

  if (message.op === "delete") {
    delete data[table][key];
  } else if (message.op === "set") {
    data[table][key] = message.record;
  } else {
    throw new Error("JSON writer received an unsupported operation: " + message.op);
  }

  revision = sequence;
  scheduleFlush();
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.op === "set" || message.op === "delete") {
    applyMutation(message);
    return;
  }

  if (message.op === "flush") {
    try {
      const sequence = await flushUntil(message.sequence);
      send({ type: "flush-result", id: message.id, ok: true, sequence });
    } catch (error) {
      send({
        type: "flush-result",
        id: message.id,
        ok: false,
        sequence: persistedRevision,
        error: lastError || error?.message || String(error)
      });
    }
    return;
  }
}

function enqueue(message) {
  messageChain = messageChain
    .then(() => handleMessage(message))
    .catch(error => {
      send({ type: "worker-error", error: error?.message || String(error) });
    });
}

parentPort.on("message", message => {
  if (!initialized) {
    startupQueue.push(message);
    return;
  }
  enqueue(message);
});

initialize();
