const { getData, saveData, hasData, delData, allData } = require("../../utils/db");
const logger = require("../../utils/logger");
const { threadCache } = require("../cache");

function normalizeThreadRecord(record, threadId) {
  if (!record) return { id: String(threadId), threadId: String(threadId), data: {} };
  const key = String(record.threadId || record.id || threadId);
  return { ...record, id: record.id || key, threadId: key, data: record.data || {} };
}

module.exports = {
  getAll: () => {
    return allData("Threads").map((row) => {
      const record = normalizeThreadRecord(row, row.threadId || row.id);
      return { threadId: record.threadId, data: record.data };
    });
  },

  getData: async (threadId) => {
    const key = String(threadId);
    const cached = threadCache.get(key);
    if (cached !== undefined) return normalizeThreadRecord(await cached, key);

    const existing = hasData("Threads", "threadId", threadId);
    if (!existing) {
      return module.exports.createData(threadId, {
        ban: false,
        admin_only: false,
        support_only: false,
        box_only: false,
        prefix: global.config.prefix
      });
    }

    const record = normalizeThreadRecord(await getData("Threads", "threadId", threadId), key);
    threadCache.set(key, record);
    return record;
  },

  setData: (threadId, data) => {
    const key = String(threadId);
    const record = normalizeThreadRecord({ id: key, threadId: key, data: data || {} }, key);
    const pending = saveData("Threads", "threadId", threadId, record.data);
    // Keep cache envelope identical to the normalized getData() shape.
    threadCache.set(key, record);
    return pending;
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
    let record;
    if (!hasData("Threads", "threadId", threadId)) {
      const data = defaultData || {};
      await saveData("Threads", "threadId", threadId, data);
      record = normalizeThreadRecord({ id: key, threadId: key, data }, key);
    } else {
      record = normalizeThreadRecord(await getData("Threads", "threadId", threadId), key);
    }
    threadCache.set(key, record);
    return record;
  }
};
