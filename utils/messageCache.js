const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const messageCachePath = path.join(__dirname, "..", "data", "message_cache.json");

fs.mkdirSync(path.dirname(messageCachePath), { recursive: true });
if (!fs.existsSync(messageCachePath)) {
    fs.writeFileSync(messageCachePath, "{}", "utf-8");
}

let messageCacheMem = null;
let cacheFlushTimer = null;
const CACHE_FLUSH_DELAY = 5000;

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
    if (messageCacheMem === null) messageCacheMem = loadMessageCacheFromDisk();
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

function flushMessageCache() {
    cacheFlushTimer = null;
    if (messageCacheMem) writeMessageJson(messageCacheMem);
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
    flushMessageCache();
}

function getMessageCache() {
    return readMessageJson();
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
        messageCache[String(clientId)] = filtered;
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
    updateMessageCache
};
