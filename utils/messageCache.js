const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const messageCachePath = path.join(__dirname, "..", "data", "message_cache.json");

fs.mkdirSync(path.dirname(messageCachePath), { recursive: true });
if (!fs.existsSync(messageCachePath)) {
    fs.writeFileSync(messageCachePath, "{}", "utf-8");
}

let messageCacheMem = null;
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
        messageCacheMem = loadMessageCacheFromDisk();
        // Old deployments may already have persisted an oversized cache.
        // Enforce the cap immediately on startup/first read, not only when a
        // new message arrives, then persist the trimmed auxiliary cache.
        if (enforceMessageCacheLimit(messageCacheMem) > 0) scheduleCacheFlush();
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

    // Snapshot before entering the serialized write queue. The file write and
    // atomic rename are asynchronous so disk latency cannot block Zalo events.
    let serialized;
    try {
        serialized = JSON.stringify(data);
    } catch (error) {
        asyncFlushFailures++;
        logger.log("Lỗi serialize message cache: " + error.message, "error");
        return Promise.resolve(false);
    }

    const startedAt = Date.now();
    const tempPath = messageCachePath + "." + process.pid + ".tmp";
    cacheWriteQueue = cacheWriteQueue
        .catch(() => {})
        .then(async () => {
            await fs.promises.writeFile(tempPath, serialized, "utf-8");
            await fs.promises.rename(tempPath, messageCachePath);
            asyncFlushCount++;
            asyncFlushLastMs = Math.max(0, Date.now() - startedAt);
            return true;
        })
        .catch(async error => {
            asyncFlushFailures++;
            try { await fs.promises.unlink(tempPath); } catch {}
            logger.log("Lỗi ghi message cache bất đồng bộ: " + error.message, "error");
            return false;
        });
    return cacheWriteQueue;
}

function flushMessageCache() {
    cacheFlushTimer = null;
    return messageCacheMem ? writeMessageJsonAsync(messageCacheMem) : Promise.resolve(false);
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
    if (messageCacheMem) writeMessageJson(messageCacheMem);
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
        asyncFlushLastMs
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
    MAX_MESSAGE_CACHE_ENTRIES
};
