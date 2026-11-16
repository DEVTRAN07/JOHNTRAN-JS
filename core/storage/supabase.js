// Storage adapter cho Supabase
const { createClient } = require("@supabase/supabase-js");
const logger = require("../../utils/logger");

const TABLE_MAP = {
  Users: "bot_users",
  Threads: "bot_threads",
  Metrics: "bot_metrics",
  BotStats: "bot_stats",
  MediaCache: "bot_media_cache"
};

const SYNC_INTERVAL = Number(process.env.SUPABASE_SYNC_MS) || 30000;
const BACKOFF_CAP = 5 * 60 * 1000;
const LOG_COOLDOWN = 60 * 1000;
const RETRY_CONCURRENCY = 5;
const RETRY_BASE_DELAY_MS = Math.max(1000, Number(process.env.JT_SUPABASE_RETRY_BASE_MS) || 5000);
const RETRY_MAX_DELAY_MS = Math.max(RETRY_BASE_DELAY_MS, Number(process.env.JT_SUPABASE_RETRY_MAX_MS) || BACKOFF_CAP);
const SYNC_ENABLED = process.env.JT_SUPABASE_SYNC !== "0";

// "Prepared" query specs for consistent, reusable Supabase operations.
// supabase-js uses PostgREST over HTTP (no SQL prepared statements on the client),
// so we centralize shapes/options here and reuse them for predictable execution.
const PREPARED_STATEMENTS = Object.freeze({
  selectMirror: Object.freeze({ columns: "id, data, updated_at" }),
  selectById: Object.freeze({ columns: "id, data, updated_at" }),
  upsert: Object.freeze({ onConflict: "id" }),
  deleteById: Object.freeze({ column: "id" }),
  healthProbe: Object.freeze({ columns: "id", head: true, count: "exact", limit: 1 })
});

function resolveSupabaseClientOptions(options = {}) {
  const poolMax = Number(process.env.SUPABASE_POOL_MAX || process.env.DB_POOL_MAX || 10);
  const keepAlive = process.env.SUPABASE_HTTP_KEEPALIVE !== "0";
  const url = String(options.url || process.env.SUPABASE_URL || "");
  const pgbouncer = process.env.PGBOUNCER_ENABLED === "1" || /pooler\.supabase\.com|:6543/.test(url);
  const headers = { "x-client-info": options.clientInfo || "johntran-bot/supabase-store", ...(options.headers || {}) };
  return {
    auth: { persistSession: false, autoRefreshToken: false, ...(options.auth || {}) },
    db: { schema: options.schema || "public", ...(options.db || {}) },
    global: { headers, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.global || {}) },
    realtime: { params: { eventsPerSecond: 2 }, ...(options.realtime || {}) },
    pool: { mode: pgbouncer ? "transaction" : "direct", max: Number.isFinite(poolMax) ? poolMax : 10, keepAlive, preparedStatements: !pgbouncer, ...(options.pool || {}) }
  };
}

class SupabaseStore {
  constructor(url, serviceKey, options = {}) {
    if (!url || !serviceKey) throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY");
    this.url = url;
    this.clientOptions = resolveSupabaseClientOptions({ ...options, url });
    this.prepared = PREPARED_STATEMENTS;
    this.client = createClient(url, serviceKey, this.clientOptions);
    this.mirror = { Users: {}, Threads: {}, Metrics: {} };
    // Keep only the latest failed mutation per table/id, not every retry copy.
    this.retryQueue = new Map();
    this.writeVersions = new Map();
    // Keep the last local mutation version after its network write finishes.
    // A SELECT that started before that mutation can still return afterwards.
    this.mutationVersions = new Map();
    this.writeChains = new Map();
    this.writeSequence = 0;
    this.retryFlush = null;
    this.retryTimer = null;
    this.syncing = null;
    this.lastSyncAt = 0;
    this.syncError = null;
    this.classified = null;
    this.consecutiveFailures = 0;
    this.lastFailureLogAt = 0;
    this.nextSyncDelay = SYNC_INTERVAL;
    this.metrics = { reads: 0, writes: 0, retries: 0, healthChecks: 0 };
    if (SYNC_ENABLED) {
      this.readyPromise = this.sync().then(() => {
        // sync() may complete optional tables while bot_threads is missing.
        // Do not clear a required-table error after a partial initial sync.
        if (!this.syncError) this.syncError = null;
      }).catch((error) => {
        this.syncError = error.message;
        this.classified = this.classifyError(error);
        this.logFailure(`Lần đồng bộ đầu thất bại: ${error.message}`, this.classified || "unknown", true);
      });
      this.scheduleInterval(SYNC_INTERVAL);
    } else {
      this.readyPromise = Promise.resolve(this.getStatus());
      this.syncError = null;
    }
  }

  scheduleInterval(delay) {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.sync().catch((error) => { this.logFailure(`Đồng bộ lỗi: ${error.message}`, this.classifyError(error), true); });
      this.flushRetry({ force: false }).catch(() => {});
    }, delay);
    this.interval.unref?.();
  }

  scheduleRetryFlush(delayMs = RETRY_BASE_DELAY_MS) {
    if (this.retryTimer || this.retryQueue.size === 0) return;
    const timer = setTimeout(() => {
      if (this.retryTimer !== timer) return;
      this.retryTimer = null;
      this.flushRetry({ force: false }).catch((error) => {
        this.logFailure(`Retry queue gặp lỗi: ${error.message}`, this.classifyError(error));
      });
    }, Math.max(1, Number(delayMs) || 1));
    timer.unref?.();
    this.retryTimer = timer;
  }

  retryDelay(attempt) {
    return Math.min(RETRY_BASE_DELAY_MS * (2 ** Math.max(0, Number(attempt) || 0)), RETRY_MAX_DELAY_MS);
  }

  classifyError(err) {
    const msg = String((err && err.message) || err || "").toLowerCase();
    const netPatterns = ["fetch failed", "econnreset", "enotfound", "eai_again", "getaddrinfo", "econnrefused", "etimedout", "timeout", "abort", "socket"];
    const cfgPatterns = ["invalid api key", "jwt", "row level security", "unauthorized", "permission denied"];
    if (netPatterns.some((p) => msg.includes(p))) return "network";
    if (cfgPatterns.some((p) => msg.includes(p))) return "config";
    return "unknown";
  }

  safeHost() { try { return new URL(this.url).host; } catch { return ""; } }

  logFailure(msg, classified, hint = false) {
    const now = Date.now();
    if (now - this.lastFailureLogAt < LOG_COOLDOWN) return;
    this.lastFailureLogAt = now;
    const host = this.safeHost();
    const extra = (hint && classified === "network") ? " Kiểm tra SUPABASE_URL, SUPABASE_SERVICE_KEY và trạng thái project Supabase (có thể bị pause)." : "";
    logger.log(`[supabase] ${classified} failure${host ? ` (${host})` : ""}: ${msg}${extra}`, "warn", { source: "database-supabase", code: classified });
  }

  async ready() {
    await this.readyPromise;
    if (this.syncError && this.lastSyncAt === 0) {
      const hint = this.classified === "network" ? " Kiểm tra SUPABASE_URL, SUPABASE_SERVICE_KEY và trạng thái project Supabase (có thể bị pause)." : "";
      this.logFailure(`ready: ${this.syncError}${hint}`, this.classified || "unknown", true);
    }
    return this.getStatus();
  }

  tableFor(name) {
    const table = TABLE_MAP[name];
    if (!table) throw new Error(`Bảng Supabase không tồn tại: ${name}`);
    return table;
  }

  async executePrepared(name, dbTable, params = {}) {
    const spec = this.prepared[name];
    if (!spec) throw new Error(`Prepared statement không tồn tại: ${name}`);
    if (name === "selectMirror") { this.metrics.reads += 1; return this.client.from(dbTable).select(spec.columns); }
    if (name === "selectById") { this.metrics.reads += 1; return this.client.from(dbTable).select(spec.columns).eq("id", String(params.id)).maybeSingle(); }
    if (name === "upsert") { this.metrics.writes += 1; return this.client.from(dbTable).upsert(params.payload, { onConflict: spec.onConflict }); }
    if (name === "deleteById") { this.metrics.writes += 1; return this.client.from(dbTable).delete().eq(spec.column, String(params.id)); }
    if (name === "healthProbe") { this.metrics.healthChecks += 1; return this.client.from(dbTable).select(spec.columns, { head: spec.head, count: spec.count }).limit(spec.limit); }
    throw new Error(`Prepared statement chưa được triển khai: ${name}`);
  }

  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      let anySuccess = false, firstError = null, firstClassified = null;
      for (const [storeTable, dbTable] of Object.entries(TABLE_MAP)) {
        // Capture row mutations at the exact start of this table snapshot.
        // A request already in flight can return an older value after a newer
        // upsert has committed, so protecting only currently pending writes
        // is not enough.
        const snapshotVersion = this.writeSequence;
        const pendingAtSnapshotStart = new Set(
          [...this.writeVersions.keys()].filter(key => key.startsWith(`${dbTable}:`))
        );
        let data, error;
        try { const res = await this.executePrepared("selectMirror", dbTable); data = res.data; error = res.error; } catch (e) { error = e; }
        if (error) {
          if (/Could not find the table/i.test(String(error.message || error))) {
            this.mirror[storeTable] = this.mirror[storeTable] || {};
            // bot_threads is essential for group ON/OFF persistence. Treat a
            // missing table as unhealthy instead of silently accepting OFF.
            if (storeTable === "Threads") {
              const msg = "Supabase thiếu bảng bot_threads; chạy supabase/schema.sql để tạo bảng cấu hình nhóm";
              if (!firstError) { firstError = msg; firstClassified = "config"; }
              this.syncError = msg;
              this.classified = "config";
              this.logFailure(msg, "config", false);
            }
            continue;
          }
          const classified = this.classifyError(error);
          const msg = `Supabase ${dbTable}: ${error.message || error}`;
          if (!firstError) { firstError = msg; firstClassified = classified; }
          this.logFailure(msg, classified, true);
          this.syncError = msg; this.classified = classified;
          if (!this.mirror[storeTable]) this.mirror[storeTable] = {};
          continue;
        }
        anySuccess = true;
        const next = {};
        for (const row of data || []) next[String(row.id)] = { ...row, data: row.data || {} };

        // A remote snapshot can be older than a local write still in flight
        // or can have started before a newer mutation that already committed.
        // Preserve local rows touched while this SELECT was in flight, rows
        // whose writes were pending when it began, and writes still pending now.
        // This covers successful writes too: push() removes writeVersions on
        // acknowledgement, but an older SELECT may still complete afterwards.
        const pendingPrefix = `${dbTable}:`;
        for (const [writeKey, version] of this.mutationVersions) {
          if (!writeKey.startsWith(pendingPrefix)) continue;
          const pendingAtStart = pendingAtSnapshotStart.has(writeKey);
          const changedAfterSnapshotStarted = version > snapshotVersion;
          const pendingNow = this.writeVersions.has(writeKey);
          if (pendingAtStart || changedAfterSnapshotStarted || pendingNow) {
            const id = writeKey.slice(pendingPrefix.length);
            const localRecord = this.mirror[storeTable]?.[id];
            if (localRecord) next[id] = localRecord;
            else delete next[id]; // Preserve a local delete as well.
          } else {
            // This snapshot began after the last mutation had completed, so
            // the remote result is now authoritative for this row.
            this.mutationVersions.delete(writeKey);
          }
        }
        // Backward-compatible safety for pending rows introduced before
        // mutationVersions existed (and tests/adapters that seed writeVersions).
        for (const [writeKey] of this.writeVersions) {
          if (!writeKey.startsWith(pendingPrefix)) continue;
          const id = writeKey.slice(pendingPrefix.length);
          const localRecord = this.mirror[storeTable]?.[id];
          if (localRecord) next[id] = localRecord;
          else delete next[id];
        }
        this.mirror[storeTable] = next;
      }
      if (firstError) {
        this.consecutiveFailures += 1;
        this.syncError = firstError;
        this.classified = firstClassified;
        this.nextSyncDelay = Math.min(SYNC_INTERVAL * Math.pow(2, this.consecutiveFailures), BACKOFF_CAP);
        // Partial success is still degraded: slow the next full snapshot too.
        this.scheduleInterval(this.nextSyncDelay);
        if (!anySuccess) throw new Error(firstError);
      } else {
        this.consecutiveFailures = 0;
        this.syncError = null;
        this.classified = null;
        this.nextSyncDelay = SYNC_INTERVAL;
        this.scheduleInterval(SYNC_INTERVAL);
      }
      this.lastSyncAt = Date.now();
      return true;
    })().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async executeWrite(dbTable, op, payload) {
    if (op === "upsert") {
      const { error } = await this.executePrepared("upsert", dbTable, { payload });
      if (error) throw new Error(error.message);
      return true;
    }
    if (op === "delete") {
      const { error } = await this.executePrepared("deleteById", dbTable, { id: payload.id });
      if (error) throw new Error(error.message);
      return true;
    }
    throw new Error(`Supabase write operation không hợp lệ: ${op}`);
  }

  enqueueWrite(key, run) {
    // Serialize writes to the same row. Otherwise a slow old upsert could
    // finish after a newer delete and resurrect stale data in Supabase.
    const previous = this.writeChains.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(run);
    const tracked = task.then(
      (value) => {
        if (this.writeChains.get(key) === tracked) this.writeChains.delete(key);
        return value;
      },
      (error) => {
        if (this.writeChains.get(key) === tracked) this.writeChains.delete(key);
        throw error;
      }
    );
    this.writeChains.set(key, tracked);
    return tracked;
  }

  push(dbTable, op, payload, { wait = false } = {}) {
    const id = String(payload?.id ?? "");
    if (!id) {
      const error = new Error(`Thiếu record id cho ${dbTable}`);
      logger.log(`[supabase] Bỏ qua ${op}: ${error.message}`, "warn", { source: "database-supabase", code: "mutation-rejected" });
      if (wait) return Promise.reject(error);
      return;
    }

    const key = `${dbTable}:${id}`;
    const version = ++this.writeSequence;
    this.writeVersions.set(key, version);
    this.mutationVersions.set(key, version);
    // A newer mutation supersedes an older failed retry for this record.
    this.retryQueue.delete(key);

    const write = this.enqueueWrite(key, () => this.executeWrite(dbTable, op, payload)).then(() => {
      if (this.writeVersions.get(key) === version) this.writeVersions.delete(key);
      return true;
    }, (error) => {
      // Ignore stale failures that completed after a newer mutation.
      if (this.writeVersions.get(key) !== version) return false;

      const classified = this.classifyError(error);
      if (classified === "network") this.logFailure(`Ghi ${op} thất bại, xếp retry: ${error.message}`, classified);
      else logger.log(`[supabase] Ghi ${op} thất bại, xếp retry: ${error.message}`, "warn", { source: "database-supabase", code: "write-retry" });
      const failedAt = Date.now();
      this.retryQueue.set(key, {
        key, dbTable, op, payload, version,
        failedAt,
        retryAttempt: 0,
        nextRetryAt: failedAt + this.retryDelay(0)
      });
      this.metrics.retries += 1;
      this.scheduleRetryFlush(this.retryDelay(0));
      if (wait) throw error;
      return false;
    });

    if (wait) return write;
    // Preserve the legacy fire-and-forget contract for ordinary hot-path writes.
    write.catch(() => {});
    return undefined;
  }

  async flushRetry({ force = true } = {}) {
    if (this.retryFlush) return this.retryFlush;
    if (this.retryQueue.size === 0) return;

    const now = Date.now();
    const pending = [...this.retryQueue.entries()].filter(([, job]) =>
      force || !job.nextRetryAt || job.nextRetryAt <= now
    );
    if (pending.length === 0) {
      const nextAt = Math.min(...[...this.retryQueue.values()].map(job => job.nextRetryAt || now + RETRY_BASE_DELAY_MS));
      this.scheduleRetryFlush(Math.max(1, nextAt - now));
      return;
    }

    this.retryFlush = (async () => {
      for (let offset = 0; offset < pending.length; offset += RETRY_CONCURRENCY) {
        const batch = pending.slice(offset, offset + RETRY_CONCURRENCY);
        await Promise.all(batch.map(async ([key, job]) => {
          if (this.writeVersions.get(key) !== job.version ||
              this.retryQueue.get(key)?.version !== job.version) return;

          try {
            await this.enqueueWrite(key, () => this.executeWrite(job.dbTable, job.op, job.payload));
            if (this.writeVersions.get(key) === job.version &&
                this.retryQueue.get(key)?.version === job.version) {
              this.retryQueue.delete(key);
              this.writeVersions.delete(key);
            }
          } catch (error) {
            if (this.writeVersions.get(key) === job.version &&
                this.retryQueue.get(key)?.version === job.version) {
              const retryAttempt = (Number(job.retryAttempt) || 0) + 1;
              const delay = this.retryDelay(retryAttempt);
              const updated = {
                ...job,
                retryAttempt,
                lastAttemptAt: Date.now(),
                nextRetryAt: Date.now() + delay,
                lastError: error.message || String(error)
              };
              this.retryQueue.set(key, updated);
              const classified = this.classifyError(error);
              if (classified === "network") this.logFailure(`Retry ${job.op} thất bại (lần ${retryAttempt}), thử lại sau ${Math.ceil(delay / 1000)}s: ${error.message}`, classified);
              else logger.log(`[supabase] Retry ${job.op} thất bại: ${error.message}`, "warn", { source: "database-supabase", code: "write-retry" });
            }
          }
        }));
      }
    })().finally(() => {
      this.retryFlush = null;
      if (this.retryQueue.size) {
        const nextAt = Math.min(...[...this.retryQueue.values()].map(job => job.nextRetryAt || Date.now() + RETRY_BASE_DELAY_MS));
        this.scheduleRetryFlush(Math.max(1, nextAt - Date.now()));
      } else if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    });

    return this.retryFlush;
  }

  async healthCheck({ tables } = {}) {
    const targets = Array.isArray(tables) && tables.length ? tables : Object.values(TABLE_MAP);
    const started = Date.now();
    const report = { ok: true, latencyMs: null, checkedAt: new Date().toISOString(), tables: {} };
    for (const dbTable of targets) {
      const t0 = Date.now();
      try {
        const res = await this.executePrepared("healthProbe", dbTable);
        report.tables[dbTable] = { ok: !res.error, latencyMs: Date.now() - t0, count: typeof res.count === "number" ? res.count : null, error: res.error ? res.error.message : null };
        if (res.error) report.ok = false;
      } catch (e) {
        report.tables[dbTable] = { ok: false, latencyMs: Date.now() - t0, error: e.message || String(e) }; report.ok = false;
      }
    }
    report.latencyMs = Date.now() - started;
    return report;
  }

  getStatus() {
    const tableCounts = Object.fromEntries(
      Object.keys(TABLE_MAP).map(tableName => [
        tableName,
        Object.keys(this.mirror[tableName] || {}).length
      ])
    );
    return {
      driver: "supabase",
      ok: !this.syncError && this.lastSyncAt > 0,
      ready: !this.syncError && this.lastSyncAt > 0,
      durable: true,
      sharedStore: true,
      syncEnabled: SYNC_ENABLED,
      lastSyncAt: this.lastSyncAt,
      lastSyncAgeMs: this.lastSyncAt ? Math.max(0, Date.now() - this.lastSyncAt) : null,
      syncError: this.syncError,
      consecutiveFailures: this.consecutiveFailures,
      nextSyncDelayMs: this.nextSyncDelay,
      classified: this.classified,
      tableCounts,
      pendingWrites: this.writeVersions.size,
      retryQueueSize: this.retryQueue.size,
      retryAttempts: [...this.retryQueue.values()].reduce((total, job) => total + (Number(job.retryAttempt) || 0), 0),
      nextRetryAt: this.retryQueue.size
        ? Math.min(...[...this.retryQueue.values()].map(job => Number(job.nextRetryAt) || Date.now()))
        : null,
      pool: this.clientOptions?.pool || null,
      metrics: { ...this.metrics, retryQueue: this.retryQueue.size },
      persistence: {
        status: "managed-remote",
        confirmed: true,
        message: "Cấu hình database được lưu trên Supabase; registry và file tài khoản local vẫn cần nơi lưu trữ bền vững riêng nếu dùng Panel nhiều bot."
      }
    };
  }

  get(tableName, idField, id) { const key = String(id); const row = this.mirror[tableName]?.[key]; return row ? { ...row } : null; }
  has(tableName, idField, id) { return Boolean(this.mirror[tableName]?.[String(id)]); }
  set(tableName, idField, id, dataObj, extra = {}) {
    const table = this.tableFor(tableName); const key = String(id);
    const payload = { id: key, data: dataObj, ...extra, updated_at: new Date().toISOString() };
    if (!this.mirror[tableName]) this.mirror[tableName] = {};
    this.mirror[tableName][key] = payload;
    this.push(table, "upsert", payload);
    return payload;
  }

  async setAndWait(tableName, idField, id, dataObj, extra = {}) {
    const table = this.tableFor(tableName); const key = String(id);
    const payload = { id: key, data: dataObj, ...extra, updated_at: new Date().toISOString() };
    if (!this.mirror[tableName]) this.mirror[tableName] = {};
    this.mirror[tableName][key] = payload;
    await this.push(table, "upsert", payload, { wait: true });
    return payload;
  }
  delete(tableName, idField, id) {
    const table = this.tableFor(tableName); const key = String(id);
    const existed = Boolean(this.mirror[tableName]?.[key]);
    if (this.mirror[tableName]) delete this.mirror[tableName][key];
    if (existed) this.push(table, "delete", { id: key });
    return existed;
  }
  all(tableName) { return Object.values(this.mirror[tableName] || {}); }
  count(tableName) { return Object.keys(this.mirror[tableName] || {}).length; }
  flushSync() { return true; }
}

module.exports = { SupabaseStore, TABLE_MAP, PREPARED_STATEMENTS, resolveSupabaseClientOptions };
