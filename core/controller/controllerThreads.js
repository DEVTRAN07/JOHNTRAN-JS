const { getData, saveData, saveDataAndWait, hasData, delData, allData, db: databaseBackend } = require("../runtime/adapters/database");
const logger = require("../../utils/logger");
const { threadCache } = require("../cache");

function normalizeThreadRecord(record, threadId) {
  const key = String(record?.threadId || record?.id || threadId);
  const data = {
    ...(record?.data || {}),
    // Missing or malformed legacy flags are OFF; only explicit true enables a group.
    bot_enabled: record?.data?.bot_enabled === true
  };
  return { ...(record || {}), id: record?.id || key, threadId: key, data };
}

function preserveBotEnabled(threadId, inputData) {
  const key = String(threadId);
  const input = inputData && typeof inputData === "object" ? inputData : {};

  // Explicit boolean writes are authoritative: only an explicit false
  // (for example /bot off or the Panel toggle) can turn an enabled group OFF.
  if (Object.prototype.hasOwnProperty.call(input, "bot_enabled")) {
    return { ...input, bot_enabled: input.bot_enabled === true };
  }

  // Older commands sometimes persist a partial settings object. Preserve
  // the current group switch instead of interpreting an omitted field as OFF.
  let existing = null;
  try {
    if (hasData("Threads", "threadId", key)) {
      existing = getData("Threads", "threadId", key);
    }
  } catch {}

  if (!existing) {
    const cached = threadCache.get(key);
    if (cached && typeof cached.then !== "function") existing = cached;
  }

  return {
    ...input,
    bot_enabled: existing?.data?.bot_enabled === true
  };
}

function getStoreStatus() {
  try {
    return typeof databaseBackend?.getStatus === "function"
      ? databaseBackend.getStatus()
      : null;
  } catch {
    return { ok: false, syncError: "Không đọc được trạng thái database" };
  }
}

async function ensureStoreReady() {
  if (typeof databaseBackend?.ready === "function") {
    await databaseBackend.ready();
  }
  const status = getStoreStatus();
  if (status?.ok === false) {
    throw new Error(status.syncError || "Database nhóm chưa đồng bộ xong");
  }
  return true;
}

module.exports = {
  getAll: () => {
    return allData("Threads").map((row) => {
      const record = normalizeThreadRecord(row, row.threadId || row.id);
      return { threadId: record.threadId, data: record.data };
    });
  },

  // Synchronous hot-path lookup: realtime messages in active groups should
  // not yield to an async cache read before command parsing starts.
  getCachedData: (threadId) => {
    const key = String(threadId);
    // Supabase starts with an empty mirror while its first snapshot is loading.
    // Never create a default-OFF record during that window.
    const status = getStoreStatus();
    if (status?.ok === false) return null;
    const cached = threadCache.get(key);
    if (cached !== undefined) {
      return cached && typeof cached.then !== "function"
        ? normalizeThreadRecord(cached, key)
        : null;
    }

    // JSON/Supabase adapters expose an in-memory mirror. Read it synchronously
    // on the message hot path; remote persistence remains background work.
    try {
      let record;
      if (hasData("Threads", "threadId", key)) {
        record = normalizeThreadRecord(getData("Threads", "threadId", key), key);
      } else {
        const data = {
          ban: false,
          admin_only: false,
          support_only: false,
          box_only: false,
          bot_enabled: false,
          prefix: global.config?.prefix || "/"
        };
        saveData("Threads", "threadId", key, data);
        record = normalizeThreadRecord({ id: key, threadId: key, data }, key);
      }
      if (record && typeof record.then !== "function") threadCache.set(key, record);
      return record && typeof record.then !== "function" ? record : null;
    } catch {
      return null;
    }
  },

  getData: async (threadId) => {
    const key = String(threadId);
    await ensureStoreReady();
    const cached = threadCache.get(key);
    if (cached !== undefined) return normalizeThreadRecord(await cached, key);

    const existing = hasData("Threads", "threadId", threadId);
    if (!existing) {
      return module.exports.createData(threadId, {
        ban: false,
        admin_only: false,
        support_only: false,
        box_only: false,
        bot_enabled: false,
        prefix: global.config.prefix
      });
    }

    const record = normalizeThreadRecord(await getData("Threads", "threadId", threadId), key);
    threadCache.set(key, record);
    return record;
  },

  setData: (threadId, data) => {
    const key = String(threadId);
    const status = getStoreStatus();
    if (status?.ok === false) {
      return Promise.reject(new Error(status.syncError || "Database nhóm chưa sẵn sàng; không ghi đè cấu hình nhóm"));
    }
    const safeData = preserveBotEnabled(key, data);
    const record = normalizeThreadRecord({ id: key, threadId: key, data: safeData }, key);
    // Keep the legacy fast write contract for existing settings callers.
    const pending = saveData("Threads", "threadId", key, record.data);
    threadCache.set(key, record);
    return pending;
  },

  setDataAndWait: async (threadId, data) => {
    const key = String(threadId);
    await ensureStoreReady();
    const safeData = preserveBotEnabled(key, data);
    const record = normalizeThreadRecord({ id: key, threadId: key, data: safeData }, key);
    // Critical ON/OFF controls wait for the storage backend to confirm commit.
    const pending = typeof saveDataAndWait === "function"
      ? saveDataAndWait("Threads", "threadId", key, record.data)
      : saveData("Threads", "threadId", key, record.data);
    threadCache.set(key, record);
    await pending;
    return record;
  },

  delData: (threadId) => {
    const key = String(threadId);
    if (hasData("Threads", "threadId", threadId)) {
      delData("Threads", "threadId", threadId);
    }
    threadCache.invalidate(key);
  },

  createData: async (threadId, defaultData = {}) => {
    const key = String(threadId);
    await ensureStoreReady();
    let record;
    if (!hasData("Threads", "threadId", threadId)) {
      const data = {
        ...(defaultData || {}),
        bot_enabled: defaultData?.bot_enabled === true
      };
      await saveData("Threads", "threadId", threadId, data);
      record = normalizeThreadRecord({ id: key, threadId: key, data }, key);
    } else {
      record = normalizeThreadRecord(await getData("Threads", "threadId", threadId), key);
    }
    threadCache.set(key, record);
    return record;
  }
};
