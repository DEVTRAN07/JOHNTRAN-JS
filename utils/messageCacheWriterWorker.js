"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { parentPort, workerData, threadId } = require("node:worker_threads");

const file = path.resolve(String(workerData?.file || ""));
const tempFile = file + "." + process.pid + "." + threadId + ".tmp";
let cache = Object.create(null);
let initialized = false;
let startupQueue = [];
let messageChain = Promise.resolve();
let revision = 0;
let persistedRevision = 0;
let flushPromise = null;

function send(message) {
    try { parentPort.postMessage(message); } catch { /* parent is shutting down */ }
}

function normalizeSnapshot(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
    return value;
}

function applyMutation(mutation) {
    const key = String(mutation?.key ?? "");
    if (!key) return false;
    if (mutation.op === "delete") delete cache[key];
    else if (mutation.op === "upsert") cache[key] = mutation.value;
    else return false;
    revision++;
    return true;
}

async function flushSnapshot() {
    if (flushPromise) return flushPromise;
    if (persistedRevision >= revision) {
        return { ok: true, durationMs: 0, entries: Object.keys(cache).length };
    }

    const snapshotRevision = revision;
    const startedAt = Date.now();
    let serialized;
    try {
        // Critical: this JSON.stringify runs in the Worker isolate, never in the Zalo event loop.
        serialized = JSON.stringify(cache);
    } catch (error) {
        return { ok: false, error: error?.message || String(error), durationMs: Date.now() - startedAt };
    }

    flushPromise = (async () => {
        try {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(tempFile, serialized, "utf8");
            await fs.rename(tempFile, file);
            persistedRevision = Math.max(persistedRevision, snapshotRevision);
            return {
                ok: true,
                durationMs: Date.now() - startedAt,
                entries: Object.keys(cache).length
            };
        } catch (error) {
            try { await fs.unlink(tempFile); } catch {}
            return { ok: false, error: error?.message || String(error), durationMs: Date.now() - startedAt };
        }
    })().finally(() => { flushPromise = null; });

    return flushPromise;
}

async function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.op === "upsert" || message.op === "delete") {
        applyMutation(message);
        return;
    }
    if (message.op === "batch") {
        for (const mutation of Array.isArray(message.mutations) ? message.mutations : []) {
            applyMutation(mutation);
        }
        return;
    }
    if (message.op === "replace") {
        cache = normalizeSnapshot(message.value);
        revision++;
        return;
    }
    if (message.op === "flush") {
        const result = await flushSnapshot();
        send({ type: "flush-result", id: message.id, ...result });
    }
}

function enqueue(message) {
    messageChain = messageChain.then(() => handleMessage(message)).catch(error => {
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

async function initialize() {
    try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw);
        cache = normalizeSnapshot(parsed);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            send({ type: "ready", ok: false, error: error?.message || String(error) });
            return;
        }
    }

    initialized = true;
    send({ type: "ready", ok: true, entries: Object.keys(cache).length });
    const queued = startupQueue;
    startupQueue = [];
    for (const message of queued) enqueue(message);
}

initialize();
