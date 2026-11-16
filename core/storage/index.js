const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { getJsonPersistenceStatus } = require("./diagnostics");

const DEFAULT_FLUSH_DELAY = 400;

class JsonStore {
  constructor(file, tables = []) {
    this.file = path.resolve(file);
    this.data = {};
    this.flushTimer = null;
    this.pendingFlush = false;
    this.lastFlushAt = 0;
    this.lastFlushError = null;
    this.lastLoadError = null;
    this.loaded = false;
    this.loadError = null;
    this.lastFlushError = null;
    this.lastWriteAt = 0;
    this.lastFlushAt = 0;

    for (const table of tables) this.data[table] = {};

    this.load(tables);

    // ghi nốt dữ liệu khi thoát
    const flush = () => this.flushSync();
    process.on("exit", flush);
    process.on("SIGINT", () => { flush(); process.exit(0); });
    process.on("SIGTERM", () => { flush(); process.exit(0); });
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
    if (this.lastFlushError) {
      throw new Error(`JSON database chưa ghi được xuống đĩa: ${this.lastFlushError}`);
    }
  }

  set(table, idField, id, dataObj, extra = {}) {
    this.assertWritable();
    const key = String(id);
    const record = { [idField]: key, data: dataObj, ...extra, updatedAt: Date.now() };
    this.table(table)[key] = record;
    this.lastWriteAt = Date.now();
    this.scheduleFlush();
    return record;
  }

  delete(table, idField, id) {
    this.assertWritable();
    const key = String(id);
    const existed = this.has(table, idField, key);
    delete this.table(table)[key];
    this.lastWriteAt = Date.now();
    this.scheduleFlush();
    return existed;
  }

  all(table) {
    return Object.values(this.table(table));
  }

  count(table) {
    return Object.keys(this.table(table)).length;
  }

  scheduleFlush() {
    this.pendingFlush = true;
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
      lastFlushError: this.lastFlushError,
      persistence: getJsonPersistenceStatus(this.file)
    };
  }
}

module.exports = { JsonStore };
