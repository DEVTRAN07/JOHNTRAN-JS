const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { getJsonPersistenceStatus } = require("./diagnostics");

const { Worker } = require("node:worker_threads");

const DEFAULT_FLUSH_DELAY = 400;
const WRITER_ACK_TIMEOUT_MS = 30000;

class JsonStore {
  constructor(file, tables = []) {
    this.file = path.resolve(file);
    this.data = {};
    this.flushTimer = null;
    this.pendingFlush = false;
    this.loaded = false;
    this.loadError = null;
    this.lastLoadError = null;
    this.lastFlushError = null;
    this.lastWriteAt = 0;
    this.lastFlushAt = 0;
    this.writerWorker = null;
    this.writerReady = false;
    this.writerFailed = false;
    this.writerSequence = 0;
    this.persistedSequence = 0;
    this.flushRequestSequence = 0;
    this.flushRequests = new Map();
    this.beforeExitFlush = null;

    for (const table of tables) this.data[table] = {};

    this.load(tables);
    if (this.loaded && process.env.JT_JSON_WRITER_WORKER !== "0") {
      this.startWriterWorker(tables);
    }

    // Drain pending worker writes before a normal event-loop shutdown. The
    // worker is ref'ed only while a durable flush request is outstanding.
    process.on("beforeExit", () => {
      if (!this.pendingFlush || this.beforeExitFlush) return;
      this.beforeExitFlush = this.flushAndWait()
        .catch(error => {
          logger.log("JSON writer worker không flush được trước khi thoát: " + error.message, "error");
          this.flushSync();
        })
        .finally(() => { this.beforeExitFlush = null; });
    });

    // Last-resort synchronous safety net for explicit process.exit() paths.
    const flush = () => {
      try { this.writerWorker?.terminate(); } catch {}
      this.writerWorker = null;
      this.flushSync();
    };
    process.on("exit", flush);
    process.on("SIGINT", () => {
      void this.flushAndWait().catch(() => this.flushSync()).finally(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void this.flushAndWait().catch(() => this.flushSync()).finally(() => process.exit(0));
    });
  }

  load(tables) {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Cấu trúc database JSON không hợp lệ");
        }
        for (const table of tables) {
          const value = parsed[table];
          if (value != null && (typeof value !== "object" || Array.isArray(value))) {
            throw new Error(`Bảng ${table} không phải object hợp lệ`);
          }
          this.data[table] = value || {};
        }
        const count = Object.values(this.data).reduce((sum, table) => sum + Object.keys(table).length, 0);
        logger.log(`Đã nạp ${count} bản ghi từ ${path.basename(this.file)}`, "info");
      }
      this.loaded = true;
    } catch (error) {
      this.loadError = error.message || String(error);
      this.lastLoadError = this.loadError;
      this.loaded = false;
      logger.log(`Không thể đọc ${this.file}: ${this.loadError}. Tạm khóa ghi để tránh ghi đè database gốc.`, "error");
    }
  }

  table(name) {
    if (!this.data[name]) this.data[name] = {};
    return this.data[name];
  }

  has(table, idField, id) {
    return Object.prototype.hasOwnProperty.call(this.table(table), String(id));
  }

  get(table, idField, id) {
    const record = this.table(table)[String(id)];
    return record ? { ...record } : null;
  }

  assertWritable() {
    if (this.loadError) {
      throw new Error(`JSON database bị lỗi khi đọc; từ chối ghi đè dữ liệu: ${this.loadError}`);
    }
    if (this.lastFlushError && this.pendingFlush) {
      // Retry a previously failed flush before accepting another write. This
      // lets the store recover automatically after a transient disk problem.
      if (!this.flushSync()) {
        throw new Error(`JSON database chưa ghi được xuống đĩa: ${this.lastFlushError}`);
      }
    } else if (this.lastFlushError) {
      throw new Error(`JSON database chưa ghi được xuống đĩa: ${this.lastFlushError}`);
    }
  }

  set(table, idField, id, dataObj, extra = {}) {
    this.assertWritable();
    const key = String(id);
    const record = { [idField]: key, data: dataObj, ...extra, updatedAt: Date.now() };
    this.table(table)[key] = record;
    this.lastWriteAt = Date.now();
    if (!this.enqueueWriterMutation("set", table, key, record)) this.scheduleFlush();
    else this.pendingFlush = true;
    return record;
  }

  delete(table, idField, id) {
    this.assertWritable();
    const key = String(id);
    const existed = this.has(table, idField, key);
    delete this.table(table)[key];
    this.lastWriteAt = Date.now();
    if (!this.enqueueWriterMutation("delete", table, key)) this.scheduleFlush();
    else this.pendingFlush = true;
    return existed;
  }

  all(table) {
    return Object.values(this.table(table));
  }

  count(table) {
    return Object.keys(this.table(table)).length;
  }

  startWriterWorker(tables) {
    try {
      const worker = new Worker(path.join(__dirname, "jsonWriterWorker.js"), {
        workerData: {
          file: this.file,
          tables,
          flushDelayMs: DEFAULT_FLUSH_DELAY
        }
      });
      this.writerWorker = worker;
      worker.unref();
      worker.on("message", message => this.handleWriterMessage(message));
      worker.on("error", error => this.failWriter(error));
      worker.on("exit", code => {
        if (this.writerWorker === worker && !this.writerFailed) {
          this.failWriter(new Error("JSON writer worker exited unexpectedly (code " + code + ")"));
        }
      });
    } catch (error) {
      this.failWriter(error);
    }
  }

  handleWriterMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      if (message.ok === true) {
        this.writerReady = true;
      } else {
        this.failWriter(new Error(message.error || "JSON writer worker initialization failed"));
      }
      return;
    }

    if (message.type === "flush-status") {
      this.persistedSequence = Math.max(this.persistedSequence, Number(message.sequence) || 0);
      this.pendingFlush = this.persistedSequence < this.writerSequence;
      if (message.ok) {
        this.lastFlushAt = Date.now();
        this.lastFlushError = null;
      } else {
        this.lastFlushError = String(message.error || "JSON writer worker flush failed");
      }
      return;
    }

    if (message.type === "worker-error") {
      this.lastFlushError = String(message.error || "JSON writer worker error");
      logger.log("JSON writer worker: " + this.lastFlushError, "error");
      return;
    }

    if (message.type === "flush-result") {
      const request = this.flushRequests.get(Number(message.id));
      if (!request) return;
      this.flushRequests.delete(Number(message.id));
      clearTimeout(request.timer);
      if (message.ok === true) {
        this.persistedSequence = Math.max(this.persistedSequence, Number(message.sequence) || 0);
        this.pendingFlush = this.persistedSequence < this.writerSequence;
        this.lastFlushAt = Date.now();
        this.lastFlushError = null;
        request.resolve(true);
      } else {
        this.pendingFlush = true;
        this.lastFlushError = String(message.error || "JSON writer worker flush failed");
        request.reject(new Error(this.lastFlushError));
      }
      if (this.flushRequests.size === 0) this.writerWorker?.unref();
    }
  }

  failWriter(error) {
    if (this.writerFailed) return;
    this.writerFailed = true;
    this.writerReady = false;
    const reason = error?.message || String(error);
    if (this.pendingFlush) this.lastFlushError = reason;
    for (const [id, request] of this.flushRequests) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
      this.flushRequests.delete(id);
    }
    logger.log("JSON writer worker không khả dụng: " + reason, "warn");
    if (this.pendingFlush) this.scheduleFlush();
  }

  enqueueWriterMutation(op, table, key, record = undefined) {
    const worker = this.writerWorker;
    if (!worker || this.writerFailed) return false;
    const sequence = ++this.writerSequence;
    try {
      worker.postMessage({
        op,
        table: String(table),
        key: String(key),
        sequence,
        ...(op === "set" ? { record } : {})
      });
      return true;
    } catch (error) {
      this.writerSequence--;
      this.failWriter(error);
      return false;
    }
  }

  async flushAndWait(timeoutMs = WRITER_ACK_TIMEOUT_MS) {
    if (!this.pendingFlush) return true;
    const worker = this.writerWorker;
    if (!worker || this.writerFailed) return this.flushSync();

    const id = ++this.flushRequestSequence;
    const timeout = Math.max(1000, Number(timeoutMs) || WRITER_ACK_TIMEOUT_MS);
    worker.ref();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.flushRequests.delete(id);
        if (this.flushRequests.size === 0) worker.unref();
        reject(new Error("JSON writer worker acknowledgement timed out after " + timeout + "ms"));
      }, timeout);
      this.flushRequests.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ op: "flush", id, sequence: this.writerSequence });
      } catch (error) {
        clearTimeout(timer);
        this.flushRequests.delete(id);
        if (this.flushRequests.size === 0) worker.unref();
        reject(error);
      }
    });
  }

  scheduleFlush() {
    this.pendingFlush = true;
    // Production writes are coalesced and serialized by the background worker.
    if (this.writerWorker && !this.writerFailed) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pendingFlush) this.flushSync();
    }, DEFAULT_FLUSH_DELAY);
    this.flushTimer.unref?.();
  }

  flushSync() {
    if (this.loadError) {
      this.lastFlushError = this.loadError;
      return false;
    }
    const tmpFile = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmpFile, this.file);
      this.pendingFlush = false;
      this.lastFlushAt = Date.now();
      this.lastFlushError = null;
      return true;
    } catch (error) {
      this.pendingFlush = true;
      this.lastFlushError = error.message || String(error);
      logger.log(`Không thể ghi ${this.file}: ${this.lastFlushError}`, "error");
      try { fs.unlinkSync(tmpFile); } catch { /* bỏ qua */ }
      return false;
    }
  }

  // Lightweight health check for request hot paths. The full getStatus()
  // below also stats the JSON file and parses /proc/self/mountinfo for Panel
  // diagnostics; those synchronous filesystem probes must not run while a
  // Zalo message is being dispatched.
  getOperationalStatus() {
    return {
      driver: "json",
      ok: !this.loadError && !this.lastFlushError,
      ready: this.loaded && !this.loadError,
      loadError: this.loadError,
      lastLoadError: this.lastLoadError || this.loadError,
      lastFlushError: this.lastFlushError,
      pendingFlush: this.pendingFlush,
      writer: {
        enabled: Boolean(this.writerWorker) && !this.writerFailed,
        ready: this.writerReady,
        sequence: this.writerSequence,
        persistedSequence: this.persistedSequence
      },
      lastWriteAt: this.lastWriteAt || null,
      lastFlushAt: this.lastFlushAt || null
    };
  }

  getStatus() {
    let fileSizeBytes = null;
    try { fileSizeBytes = fs.statSync(this.file).size; } catch { /* file chưa được tạo */ }
    const tableCounts = Object.fromEntries(
      Object.entries(this.data).map(([name, table]) => [name, Object.keys(table || {}).length])
    );
    return {
      driver: "json",
      ok: !this.loadError && !this.lastFlushError,
      ready: this.loaded && !this.loadError,
      filePath: this.file,
      fileExists: fs.existsSync(this.file),
      fileSizeBytes,
      tableCounts,
      pendingFlush: this.pendingFlush,
      lastWriteAt: this.lastWriteAt || null,
      lastFlushAt: this.lastFlushAt || null,
      loadError: this.loadError,
      lastLoadError: this.lastLoadError || this.loadError,
      lastFlushError: this.lastFlushError,
      persistence: getJsonPersistenceStatus(this.file)
    };
  }
}

module.exports = { JsonStore };
