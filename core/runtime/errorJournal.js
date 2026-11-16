"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MAX_RECENT = 200;
const MAX_FINGERPRINTS = 500;
const MAX_PENDING_WRITES = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ROTATED_FILES = 3;
const DEDUPE_WINDOW_MS = 60 * 1000;
const MAX_MESSAGE_LENGTH = 1200;

const SECRET_PATTERNS = [
  /([?&](?:st|e|sig|sign|token|key|apiKey|api_key|secret|password|client_secret|access_token|imei)=)[^&\s"'\x60]*/gi,
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /\b(AIza[0-9A-Za-z_-]{20,})/g
];

function redact(value) {
  let output = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "$1***");
  return output;
}

function safeLabel(value, fallback = "unknown", max = 80) {
  const text = String(value ?? "").trim().replace(/[^a-zA-Z0-9_.:@/-]/g, "_").slice(0, max);
  return text || fallback;
}

function safeMessage(value) {
  const message = redact(value).replace(/[\r\n\t]+/g, " ").trim();
  return message.slice(0, MAX_MESSAGE_LENGTH) || "Unknown error";
}

function resolveDefaultFile() {
  if (process.env.JT_ERROR_LOG_FILE) return path.resolve(process.env.JT_ERROR_LOG_FILE);
  const botName = safeLabel(process.env.JT_BOT_NAME || global.config?.name_bot || "master", "master", 48);
  const configuredDir = String(process.env.JT_LOG_DIR || "").trim();
  const persistentRoot = String(process.env.JT_PERSISTENT_DIR || process.env.JT_DB_PERSISTENT_PATH || "").trim();
  const directory = configuredDir
    ? path.resolve(configuredDir)
    : persistentRoot
      ? path.join(path.resolve(persistentRoot), "logs")
      : path.join(ROOT, "data", "logs");
  return path.join(directory, botName + ".errors.jsonl");
}

function normalizeContext(context = {}) {
  const isGroup = context.isGroup === true || (context.isGroup !== false && context.groupId != null);
  const groupId = isGroup
    ? safeLabel(context.groupId ?? context.threadId, "", 128)
    : "";
  return {
    bot: safeLabel(context.bot || process.env.JT_BOT_NAME || global.config?.name_bot || "master", "master", 48),
    source: safeLabel(context.source, "runtime", 64),
    command: safeLabel(context.commandName || context.command, "", 64),
    event: safeLabel(context.eventName || context.eventType, "", 64),
    groupId,
    code: safeLabel(context.code, "", 64)
  };
}

function fingerprint(entry) {
  const material = [
    entry.level, entry.bot, entry.source, entry.command,
    entry.event, entry.groupId, entry.code, entry.message
  ].join("|");
  return crypto.createHash("sha1").update(material).digest("hex");
}

function readJournalFile(filePath, limit = 50) {
  const maximum = Math.max(1, Math.min(200, Number(limit) || 50));
  const target = path.resolve(filePath);
  let fd;
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size <= 0) return [];
    const length = Math.min(stat.size, MAX_FILE_BYTES);
    const buffer = Buffer.allocUnsafe(length);
    fd = fs.openSync(target, "r");
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    let raw = buffer.toString("utf8");
    if (stat.size > length) {
      const boundary = raw.indexOf("\n");
      raw = boundary >= 0 ? raw.slice(boundary + 1) : "";
    }
    return raw.split("\n").filter(Boolean).slice(-maximum).flatMap(line => {
      try {
        const item = JSON.parse(line);
        if (!item || typeof item !== "object" || !item.id || !item.timestamp) return [];
        return [{
          id: safeLabel(item.id, "", 64),
          timestamp: String(item.timestamp),
          lastAt: String(item.lastAt || item.timestamp),
          level: item.level === "warn" ? "warn" : "error",
          bot: safeLabel(item.bot, "unknown", 48),
          source: safeLabel(item.source, "runtime", 64),
          command: safeLabel(item.command, "", 64),
          event: safeLabel(item.event, "", 64),
          groupId: safeLabel(item.groupId, "", 128),
          code: safeLabel(item.code, "", 64),
          message: safeMessage(item.message),
          count: Math.max(1, Number(item.count) || 1)
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function createErrorJournal(options = {}) {
  const filePath = path.resolve(options.filePath || resolveDefaultFile());
  const now = typeof options.now === "function" ? options.now : Date.now;
  const maxRecent = Math.max(10, Number(options.maxRecent) || MAX_RECENT);
  const maxFileBytes = Math.max(64 * 1024, Number(options.maxFileBytes) || MAX_FILE_BYTES);
  const rotatedFiles = Math.max(1, Math.min(10, Number(options.rotatedFiles) || ROTATED_FILES));
  const dedupeWindowMs = Math.max(0, Number(options.dedupeWindowMs ?? DEDUPE_WINDOW_MS));

  const recent = [];
  const fingerprints = new Map();
  const pendingLines = [];
  let sequence = 0;
  let flushScheduled = false;
  let flushing = false;
  let droppedWrites = 0;
  let lastWriteAt = null;
  let lastWriteError = null;

  function remember(entry) {
    recent.push(entry);
    if (recent.length > maxRecent) recent.shift();
    const key = fingerprint(entry);
    fingerprints.delete(key);
    fingerprints.set(key, entry);
    while (fingerprints.size > MAX_FINGERPRINTS) {
      const oldest = fingerprints.keys().next().value;
      if (oldest === undefined) break;
      fingerprints.delete(oldest);
    }
    return key;
  }

  function scheduleFlush() {
    if (flushScheduled || flushing || pendingLines.length === 0) return;
    flushScheduled = true;
    setImmediate(() => {
      flushScheduled = false;
      void flush();
    });
  }

  async function rotateIfNeeded(incomingBytes) {
    let currentSize = 0;
    try { currentSize = (await fs.promises.stat(filePath)).size; }
    catch (error) { if (error.code !== "ENOENT") throw error; }

    if (currentSize + incomingBytes <= maxFileBytes) return;

    try { await fs.promises.unlink(filePath + "." + rotatedFiles); }
    catch (error) { if (error.code !== "ENOENT") throw error; }

    for (let index = rotatedFiles - 1; index >= 1; index--) {
      const source = filePath + "." + index;
      const destination = filePath + "." + (index + 1);
      try { await fs.promises.rename(source, destination); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }

    try { await fs.promises.rename(filePath, filePath + ".1"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    let inFlight = [];
    try {
      while (pendingLines.length) {
        inFlight = pendingLines.splice(0, 10);
        const payload = inFlight.join("\n") + "\n";
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await rotateIfNeeded(Buffer.byteLength(payload));
        await fs.promises.appendFile(filePath, payload, { encoding: "utf8", mode: 0o600 });
        inFlight = [];
        lastWriteAt = new Date(now()).toISOString();
        lastWriteError = null;
      }
    } catch (error) {
      lastWriteError = safeMessage(error.message || error);
      // Keep failed writes for the next incoming error / explicit flush attempt.
      if (inFlight.length) pendingLines.unshift(...inFlight);
      if (pendingLines.length > MAX_PENDING_WRITES) {
        droppedWrites += pendingLines.length - MAX_PENDING_WRITES;
        pendingLines.splice(0, pendingLines.length - MAX_PENDING_WRITES);
      }
    } finally {
      flushing = false;
      if (pendingLines.length && !lastWriteError) scheduleFlush();
    }
  }

  function record(level, message, context = {}) {
    const normalizedLevel = level === "warn" ? "warn" : "error";
    const meta = normalizeContext(context);
    const timestampMs = now();
    const messageText = safeMessage(message);
    const candidate = {
      id: "",
      timestamp: new Date(timestampMs).toISOString(),
      lastAt: new Date(timestampMs).toISOString(),
      level: normalizedLevel,
      ...meta,
      message: messageText,
      count: 1
    };
    const key = fingerprint(candidate);
    const previous = fingerprints.get(key);

    if (previous && timestampMs - Date.parse(previous.lastAt) <= dedupeWindowMs) {
      previous.count += 1;
      previous.lastAt = candidate.lastAt;
      return { ...previous, deduplicated: true };
    }

    candidate.id = crypto.createHash("sha1")
      .update(key + "|" + timestampMs + "|" + (++sequence))
      .digest("hex").slice(0, 20);
    remember(candidate);

    if (pendingLines.length < MAX_PENDING_WRITES) {
      pendingLines.push(JSON.stringify(candidate));
      scheduleFlush();
    } else {
      droppedWrites += 1;
    }
    return { ...candidate, deduplicated: false };
  }

  function recordError(message, context) {
    return record("error", message, context);
  }

  function recordWarning(message, context) {
    return record("warn", message, context);
  }

  function snapshot(limit = 50) {
    const maximum = Math.max(1, Math.min(maxRecent, Number(limit) || 50));
    const entries = recent.slice(-maximum).reverse().map(item => ({ ...item }));
    const summary = {
      total: recent.reduce((total, item) => total + item.count, 0),
      unique: recent.length,
      errors: recent.filter(item => item.level === "error").reduce((total, item) => total + item.count, 0),
      warnings: recent.filter(item => item.level === "warn").reduce((total, item) => total + item.count, 0),
      deduplicated: recent.reduce((total, item) => total + Math.max(0, item.count - 1), 0),
      bySource: {},
      byCommand: {},
      byGroup: {}
    };

    for (const item of recent) {
      summary.bySource[item.source] = (summary.bySource[item.source] || 0) + item.count;
      if (item.command) summary.byCommand[item.command] = (summary.byCommand[item.command] || 0) + item.count;
      if (item.groupId) summary.byGroup[item.groupId] = (summary.byGroup[item.groupId] || 0) + item.count;
    }

    return {
      bot: safeLabel(process.env.JT_BOT_NAME || global.config?.name_bot || "master", "master", 48),
      generatedAt: new Date(now()).toISOString(),
      summary,
      events: entries,
      persistence: {
        file: path.basename(filePath),
        queued: pendingLines.length,
        droppedWrites,
        lastWriteAt,
        lastWriteError
      }
    };
  }

  function loadRecent() {
    const loaded = [];
    for (let index = rotatedFiles; index >= 0; index--) {
      const pathToRead = index === 0 ? filePath : filePath + "." + index;
      loaded.push(...readJournalFile(pathToRead, maxRecent));
    }
    loaded.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (const item of loaded.slice(-maxRecent)) {
      recent.push(item);
      const key = fingerprint(item);
      fingerprints.set(key, item);
    }
    while (fingerprints.size > MAX_FINGERPRINTS) {
      const oldest = fingerprints.keys().next().value;
      if (oldest === undefined) break;
      fingerprints.delete(oldest);
    }
    return recent.length;
  }

  return {
    record,
    recordError,
    recordWarning,
    snapshot,
    flush,
    loadRecent,
    filePath,
    getStats: () => ({
      recent: recent.length,
      queued: pendingLines.length,
      droppedWrites,
      lastWriteAt,
      lastWriteError
    })
  };
}

const journal = createErrorJournal();
journal.loadRecent();

module.exports = {
  ...journal,
  createErrorJournal,
  readJournalFile,
  redact,
  normalizeContext,
  MAX_RECENT,
  MAX_FILE_BYTES
};
