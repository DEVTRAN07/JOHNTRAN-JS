const fs = require("fs");
const path = require("path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const { Worker } = require("node:worker_threads");
const logger = require("./logger");

const messageCachePath = path.join(__dirname, "..", "data", "message_cache.json");

fs.mkdirSync(path.dirname(messageCachePath), { recursive: true });
if (!fs.existsSync(messageCachePath)) {
    fs.writeFileSync(messageCachePath, "{}", "utf-8");
}

let messageCacheMem = null;
let messageCacheRaw = null;
let nodeCacheWriter = null;
let messageCacheEntryCount = 0;
let messageCacheFullScanCount = 0;
let cacheFlushTimer = null;
let cacheWriteQueue = Promise.resolve();
let asyncFlushCount = 0;
let asyncFlushFailures = 0;
let asyncFlushLastMs = 0;
const CACHE_FLUSH_DELAY = 5000;
const MAX_MESSAGE_CACHE_ENTRIES = 50000;
const MESSAGE_CACHE_EVICTION_BATCH = 2500;

function resolveNativeCacheBinary() {
    const configured = String(process.env.JT_MESSAGE_CACHE_NATIVE_PATH || "").trim();
    if (configured) return configured;
    const executable = process.platform === "win32" ? "jt-message-cache.exe" : "jt-message-cache";
    return path.join(__dirname, "..", "native", "bin", executable);
}

function createNativeCacheWriter(binaryPath, filePath) {
    if (!binaryPath || !fs.existsSync(binaryPath)) return null;

    let child;
    try {
        child = spawn(binaryPath, [filePath], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
        logger.log("Không thể khởi chạy Rust message-cache: " + error.message, "warn");
        return null;
    }

    let active = true;
    let nextId = 0;
    const pending = new Map();
    const lines = readline.createInterface({ input: child.stdout });

    const failPending = reason => {
        for (const [id, entry] of pending) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, error: reason || "Rust cache worker stopped" });
            pending.delete(id);
        }
    };

    lines.on("line", line => {
        let result;
        try { result = JSON.parse(line); } catch { return; }
        const id = Number(result?.id);
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve(result);
    });

    child.on("error", error => {
        active = false;
        failPending(error?.message || "Rust cache worker error");
        logger.log("Rust message-cache worker lỗi: " + (error?.message || error), "warn");
    });
    child.on("exit", (code, signal) => {
        active = false;
        failPending("Rust cache worker exited: code=" + code + ", signal=" + signal);
    });
    child.stdin.on("error", error => {
        active = false;
        failPending(error?.message || "Rust cache worker stdin error");
    });
    child.stderr.on("data", chunk => {
        const message = String(chunk || "").trim();
        if (message) logger.log("[message-cache-rs] " + message.slice(0, 500), "warn");
    });

    function send(payload) {
        if (!active || child.stdin.destroyed || !child.stdin.writable) return false;
        try {
            child.stdin.write(JSON.stringify(payload) + "\n");
            return true;
        } catch {
            active = false;
            return false;
        }
    }

    return {
        upsert(key, value) {
            return send({ op: "upsert", key: String(key), value });
        },
        delete(key) {
            return send({ op: "delete", key: String(key) });
        },
        mutateBatch(mutations) {
            if (!Array.isArray(mutations) || mutations.length === 0) return true;
            // Serialize one bounded IPC frame for a batch instead of one JSON
            // frame + pipe write for every incoming message.
            return send({
                op: "batch",
                mutations: mutations.map(item => item.op === "delete"
                    ? { op: "delete", key: String(item.key) }
                    : { op: "upsert", key: String(item.key), value: item.value })
            });
        },
        flush(timeoutMs = 30000) {
            if (!active) return Promise.resolve({ ok: false, error: "Rust cache worker unavailable" });
            const id = ++nextId;
            return new Promise(resolve => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve({ ok: false, error: "Rust cache flush timed out" });
                }, Math.max(1000, Number(timeoutMs) || 30000));
                timer.unref?.();
                pending.set(id, { resolve, timer });
                if (!send({ op: "flush", id })) {
                    pending.delete(id);
                    clearTimeout(timer);
                    resolve({ ok: false, error: "Could not write flush command to Rust worker" });
                }
            });
        },
        close() {
            if (!child.stdin.destroyed) child.stdin.end();
            if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
            return new Promise(resolve => child.once("exit", resolve));
        },
        terminate() {
            active = false;
            failPending("Rust cache worker terminated during shutdown");
            try { child.kill("SIGKILL"); } catch {}
            try { child.stdin.destroy(); } catch {}
        },
        stats() {
            return {
                available: active,
                pid: child.pid || null,
                pendingFlushes: pending.size,
                binary: binaryPath
            };
        }
    };
}

const nativeCacheWriter = createNativeCacheWriter(resolveNativeCacheBinary(), messageCachePath);

/**
 * Node-worker fallback for platforms where the optional Rust sidecar is not
 * installed. It applies small mutations in its own isolate and performs the
 * 50k-entry JSON serialization there, never in the Zalo listener thread.
 */
function createNodeCacheWriter(filePath) {
    let worker;
    try {
        worker = new Worker(path.join(__dirname, "messageCacheWriterWorker.js"), {
            workerData: { file: filePath }
        });
    } catch (error) {
        logger.log("Không thể khởi chạy message-cache worker: " + (error?.message || error), "warn");
        return null;
    }

    let active = true;
    let nextId = 0;
    const pending = new Map();

    const failPending = reason => {
        for (const [id, entry] of pending) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, error: reason || "message-cache worker stopped" });
            pending.delete(id);
        }
    };

    worker.on("message", message => {
        if (message?.type === "ready") {
            if (message.ok !== true) {
                active = false;
                logger.log("Message-cache worker không nạp được dữ liệu: " + String(message.error || "unknown"), "warn");
            }
            return;
        }
        if (message?.type === "worker-error") {
            logger.log("Message-cache worker: " + String(message.error || "unknown"), "warn");
            return;
        }
        if (message?.type !== "flush-result") return;
        const id = Number(message.id);
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve(message);
    });

    worker.on("error", error => {
        active = false;
        failPending(error?.message || "message-cache worker error");
        logger.log("Message-cache worker lỗi: " + (error?.message || error), "warn");
    });
    worker.on("exit", code => {
        active = false;
        failPending("message-cache worker exited: code=" + code);
    });

    function send(payload) {
        if (!active) return false;
        try {
            worker.postMessage(payload);
            return true;
        } catch (error) {
            logger.log("Không gửi được mutation tới message-cache worker: " + (error?.message || error), "warn");
            return false;
        }
    }

    return {
        upsert(key, value) {
            return send({ op: "upsert", key: String(key), value });
        },
        delete(key) {
            return send({ op: "delete", key: String(key) });
        },
        mutateBatch(mutations) {
            if (!Array.isArray(mutations) || mutations.length === 0) return true;
            return send({
                op: "batch",
                mutations: mutations.map(item => item.op === "delete"
                    ? { op: "delete", key: String(item.key) }
                    : { op: "upsert", key: String(item.key), value: item.value })
            });
        },
        replaceSnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
            return send({ op: "replace", value: snapshot });
        },
        flush(timeoutMs = 30000) {
            if (!active) return Promise.resolve({ ok: false, error: "message-cache worker unavailable" });
            const id = ++nextId;
            return new Promise(resolve => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve({ ok: false, error: "message-cache worker flush timed out" });
                }, Math.max(1000, Number(timeoutMs) || 30000));
                timer.unref?.();
                pending.set(id, { resolve, timer });
                if (!send({ op: "flush", id })) {
                    pending.delete(id);
                    clearTimeout(timer);
                    resolve({ ok: false, error: "could not send flush request to message-cache worker" });
                }
            });
        },
        terminate() {
            active = false;
            failPending("message-cache worker terminated during shutdown");
            return worker.terminate().catch(() => 0);
        },
        stats() {
            return {
                available: active,
                backend: "node-worker",
                threadId: worker.threadId,
                pendingFlushes: pending.size
            };
        }
    };
}

function getNodeCacheWriter(syncSnapshot = false) {
    if (!nodeCacheWriter) {
        nodeCacheWriter = createNodeCacheWriter(messageCachePath);
        // If Rust failed after accepting live mutations, seed the fallback from
        // the authoritative in-memory mirror before sending any later deltas.
        if (nodeCacheWriter && syncSnapshot && messageCacheRaw) {
            nodeCacheWriter.replaceSnapshot(messageCacheRaw);
        }
    }
    return nodeCacheWriter;
}

function getCurrentCacheWriter() {
    if (nativeCacheWriter?.stats?.().available) return nativeCacheWriter;
    return getNodeCacheWriter(Boolean(nativeCacheWriter));
}

const cachePersistenceWriter = {
    stats() {
        const writer = getCurrentCacheWriter();
        return writer ? { ...writer.stats(), backend: writer === nativeCacheWriter ? "rust" : "node-worker" } : { available: false, backend: "unavailable" };
    },
    upsert(key, value) {
        return getCurrentCacheWriter()?.upsert(key, value) ?? false;
    },
    delete(key) {
        return getCurrentCacheWriter()?.delete(key) ?? false;
    },
    mutateBatch(batch) {
        return getCurrentCacheWriter()?.mutateBatch(batch) ?? false;
    },
    replaceSnapshot(snapshot) {
        return getNodeCacheWriter(true)?.replaceSnapshot(snapshot) ?? false;
    },
    flush(timeoutMs) {
        return getCurrentCacheWriter()?.flush(timeoutMs) ?? Promise.resolve({ ok: false, error: "message-cache writer unavailable" });
    },
    terminate() {
        nativeCacheWriter?.terminate?.();
        return nodeCacheWriter?.terminate?.() || Promise.resolve(0);
    }
};

// Message-cache persistence is auxiliary. Never stringify every incoming Zalo
// event and write it to the Rust child's stdin inside the WebSocket callback.
// Keep only the latest mutation per key and send a small bounded batch from
// setImmediate; the JS Map remains the authoritative read path.
function createNativeCacheMutationQueue(writer, options = {}) {
    const batchSize = Math.max(1, Math.floor(Number(options.batchSize) || 64));
    const pending = new Map();
    const waiters = [];
    let scheduled = false;
    let sent = 0;
    let failed = 0;

    function available() {
        try { return writer?.stats?.().available === true; }
        catch { return false; }
    }

    function settleWaiters(ok) {
        while (waiters.length) {
            const resolve = waiters.shift();
            try { resolve(ok); } catch {}
        }
    }

    function drainBatch() {
        scheduled = false;
        if (!available()) {
            pending.clear();
            settleWaiters(false);
            return;
        }

        const batch = [];
        for (const [key, mutation] of pending) {
            if (batch.length >= batchSize) break;
            pending.delete(key);
            batch.push({ key, ...mutation });
        }

        let acceptedCount = 0;
        if (batch.length && typeof writer.mutateBatch === "function") {
            let accepted = false;
            try { accepted = writer.mutateBatch(batch) !== false; } catch { accepted = false; }
            if (accepted) acceptedCount = batch.length;
        } else {
            for (const mutation of batch) {
                let accepted = false;
                try {
                    accepted = mutation.op === "delete"
                        ? writer.delete(mutation.key)
                        : writer.upsert(mutation.key, mutation.value);
                } catch {
                    accepted = false;
                }
                if (accepted === false) break;
                acceptedCount++;
            }
        }

        sent += acceptedCount;
        if (acceptedCount < batch.length) {
            failed++;
            // Requeue unaccepted mutations without overwriting newer values
            // already enqueued for the same key while this batch was sent.
            for (let index = batch.length - 1; index >= acceptedCount; index--) {
                const mutation = batch[index];
                if (!pending.has(mutation.key)) {
                    pending.set(mutation.key, { op: mutation.op, ...(mutation.op === "upsert" ? { value: mutation.value } : {}) });
                }
            }
        }

        if (pending.size) {
            if (available()) scheduleDrain();
            else {
                pending.clear();
                settleWaiters(false);
            }
        } else {
            settleWaiters(true);
        }
    }

    function scheduleDrain() {
        if (scheduled || !pending.size) return;
        scheduled = true;
        setImmediate(drainBatch);
    }

    function enqueue(op, key, value) {
        if (!available()) return false;
        const normalizedKey = String(key);
        pending.set(normalizedKey, op === "delete"
            ? { op: "delete" }
            : { op: "upsert", value });
        scheduleDrain();
        return true;
    }

    function flush() {
        if (!pending.size) return Promise.resolve(available());
        return new Promise(resolve => {
            waiters.push(resolve);
            scheduleDrain();
        });
    }

    function stats() {
        return { pending: pending.size, sent, failed, batchSize, scheduled };
    }

    return { enqueue, flush, stats };
}

const nativeCacheMutations = createNativeCacheMutationQueue(cachePersistenceWriter);

function mirrorCacheMutations(cache) {
    return new Proxy(cache, {
        set(target, key, value) {
            const result = Reflect.set(target, key, value);
            if (result && typeof key === "string") nativeCacheMutations.enqueue("upsert", key, value);
            return result;
        },
        deleteProperty(target, key) {
            const existed = Object.prototype.hasOwnProperty.call(target, key);
            const result = Reflect.deleteProperty(target, key);
            if (result && existed && typeof key === "string") nativeCacheMutations.enqueue("delete", key);
            return result;
        }
    });
}


function enforceMessageCacheLimit(cache, maxEntries = MAX_MESSAGE_CACHE_ENTRIES) {
    if (!cache || typeof cache !== 'object') return 0;
    const keys = Object.keys(cache);
    messageCacheFullScanCount++;
    if (keys.length <= maxEntries) {
        if (cache === messageCacheMem) messageCacheEntryCount = keys.length;
        return 0;
    }
    const removeCount = Math.max(keys.length - maxEntries, Math.min(MESSAGE_CACHE_EVICTION_BATCH, Math.ceil(maxEntries * 0.05)));
    for (const key of keys.slice(0, removeCount)) delete cache[key];
    if (cache === messageCacheMem) messageCacheEntryCount = keys.length - removeCount;
    return removeCount;
}

function loadMessageCacheFromDisk() {
    try {
        const data = fs.readFileSync(messageCachePath, "utf-8");
        return JSON.parse(data) || {};
    } catch (error) {
        if (error.code === "ENOENT") return {};
        logger.log("Lỗi đọc file message.json: " + error.message, "error");
        return {};
    }
}

function readMessageJson() {
    if (messageCacheMem === null) {
        messageCacheRaw = loadMessageCacheFromDisk();
        messageCacheMem = mirrorCacheMutations(messageCacheRaw);
        // Old deployments may already have persisted an oversized cache.
        // Enforce the cap immediately on startup/first read, not only when a
        // new message arrives, then persist the trimmed auxiliary cache.
        if (enforceMessageCacheLimit(messageCacheMem) > 0) scheduleCacheFlush();
        // Start the fallback worker before the WebSocket listener becomes live.
        if (!nativeCacheWriter?.stats?.().available) getNodeCacheWriter();
    }
    return messageCacheMem;
}

function writeMessageJson(data) {
    try {
        const dir = path.dirname(messageCachePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(messageCachePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
        logger.log("Lỗi ghi file message.json: " + error.message, "error");
    }
}

function writeMessageJsonAsync(data) {
    if (!data) return Promise.resolve(false);
    const writer = getNodeCacheWriter(true);
    if (!writer?.stats?.().available) {
        asyncFlushFailures++;
        logger.log("Không có worker để lưu message cache; bỏ qua snapshot để không chặn event loop.", "warn");
        return Promise.resolve(false);
    }

    // Structured-clone the plain mirror once; JSON serialization and atomic
    // disk I/O both run in messageCacheWriterWorker.js.
    const snapshot = data === messageCacheMem ? messageCacheRaw : data;
    if (!writer.replaceSnapshot(snapshot)) {
        asyncFlushFailures++;
        return Promise.resolve(false);
    }
    const startedAt = Date.now();
    return writer.flush().then(result => {
        if (result?.ok !== true) {
            asyncFlushFailures++;
            return false;
        }
        asyncFlushCount++;
        asyncFlushLastMs = Math.max(0, Number(result.durationMs) || (Date.now() - startedAt));
        return true;
    });
}

function flushMessageCache() {
    cacheFlushTimer = null;
    if (!messageCacheMem) return Promise.resolve(false);

    const startedAt = Date.now();
    return nativeCacheMutations.flush().then(drained => {
        if (!drained) {
            // The router may have switched from a failed Rust process to the
            // Node worker. It syncs the latest in-memory snapshot on failover.
            const writer = getCurrentCacheWriter();
            if (!writer?.stats?.().available) throw new Error("message-cache persistence worker unavailable");
            if (writer === nodeCacheWriter && nativeCacheWriter) {
                if (!writer.replaceSnapshot(messageCacheRaw)) throw new Error("could not seed Node cache worker after Rust failure");
            }
        }
        const writer = getCurrentCacheWriter();
        if (!writer?.stats?.().available) throw new Error("message-cache persistence worker unavailable before flush");
        return writer.flush();
    }).then(result => {
        if (result?.ok === true) {
            asyncFlushCount++;
            asyncFlushLastMs = Math.max(0, Number(result.durationMs) || (Date.now() - startedAt));
            return true;
        }
        asyncFlushFailures++;
        logger.log("Message-cache flush thất bại: " + String(result?.error || "unknown"), "warn");
        return false;
    }).catch(error => {
        asyncFlushFailures++;
        logger.log("Message-cache flush lỗi: " + (error?.message || error), "warn");
        // Last-resort snapshot still serializes in a Worker, not on the listener.
        return writeMessageJsonAsync(messageCacheMem);
    });
}
function scheduleCacheFlush() {
    if (cacheFlushTimer) return;
    cacheFlushTimer = setTimeout(flushMessageCache, CACHE_FLUSH_DELAY);
    cacheFlushTimer.unref?.();
}

process.on("exit", () => {
    if (cacheFlushTimer) {
        clearTimeout(cacheFlushTimer);
        cacheFlushTimer = null;
    }
    // Stop the sidecar before writing the authoritative current JS snapshot.
    // This prevents an in-flight older Rust snapshot from winning a shutdown race.
    void cachePersistenceWriter.terminate();
    if (messageCacheRaw) writeMessageJson(messageCacheRaw);
});

function cleanOldMessages() {
    const messageCache = readMessageJson();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    Object.keys(messageCache).forEach((key) => {
        const timestamp = Number(messageCache[key]?.timestamp);
        const timestampMs = timestamp > 0
            ? timestamp < 1e12
                ? timestamp * 1000
                : timestamp > 1e14
                    ? timestamp / 1000
                    : timestamp
            : timestamp;
        if (Number.isFinite(timestampMs) && timestampMs < oneDayAgo) {
            delete messageCache[key];
        }
    });
    enforceMessageCacheLimit(messageCache);
    flushMessageCache();
}

function getMessageCache() {
    return readMessageJson();
}

function getMessageCacheStats() {
    return {
        entries: messageCacheEntryCount,
        fullScans: messageCacheFullScanCount,
        maxEntries: MAX_MESSAGE_CACHE_ENTRIES,
        asyncFlushCount,
        asyncFlushFailures,
        asyncFlushLastMs,
        nativePendingMutations: nativeCacheMutations.stats(),
        nativePersistence: nativeCacheWriter?.stats() || {
            available: false,
            reason: "Rust message-cache binary not built for this environment"
        },
        activePersistence: cachePersistenceWriter.stats()
    };
}

function updateMessageCache(data) {
    let messageCache = readMessageJson();
    try {
        const messageData = data?.data || {};
        const clientId = messageData.cliMsgId;
        const messageId = messageData.msgId;
        if (clientId == null || messageId == null || messageData.uidFrom == null) {
            logger.log(
                `Bỏ qua cache tin thiếu ID bắt buộc (cliMsgId=${clientId ?? "missing"}, msgId=${messageId ?? "missing"}, uidFrom=${messageData.uidFrom ?? "missing"})`,
                "warn"
            );
            return;
        }
        const filtered = {
            timestamp: messageData.ts || Date.now(),
            msgId: messageId,
            cliMsgId: clientId,
            msgType: messageData.msgType,
            uidFrom: messageData.uidFrom,
            idTo: messageData.idTo,
            dName: messageData.dName,
            content: messageData.content,
            threadId: data.threadId || messageData.idTo,
            type: data.type ?? messageData.type
        };
        // Refresh insertion order while maintaining O(1) size accounting.
        // Do not enumerate up to 50k keys for every incoming Zalo message.
        const cacheKey = String(clientId);
        const existed = Object.prototype.hasOwnProperty.call(messageCache, cacheKey);
        delete messageCache[cacheKey];
        messageCache[cacheKey] = filtered;
        if (!existed) messageCacheEntryCount++;

        // A full scan happens only after the estimated cap is crossed, then
        // the scan refreshes the exact count for future O(1) updates.
        if (messageCacheEntryCount > MAX_MESSAGE_CACHE_ENTRIES) {
            enforceMessageCacheLimit(messageCache);
        }
        scheduleCacheFlush();
    } catch (e) {
        logger.log("Lỗi khi update messageCache: " + e.message, "error");
    }
}

module.exports = {
    loadMessageCacheFromDisk,
    readMessageJson,
    writeMessageJson,
    flushMessageCache,
    scheduleCacheFlush,
    cleanOldMessages,
    getMessageCache,
    updateMessageCache,
    enforceMessageCacheLimit,
    getMessageCacheStats,
    createNativeCacheWriter,
    createNodeCacheWriter,
    createNativeCacheMutationQueue,
    resolveNativeCacheBinary,
    MAX_MESSAGE_CACHE_ENTRIES
};
