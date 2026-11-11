const { getData, saveData, hasData, delData, allData } = require("../../utils/db");
const logger = require("../../utils/logger");
const { threadCache } = require("../cache");

module.exports = {
  getAll: () => {
    return allData("Threads").map((row) => ({
      threadId: row.threadId,
      data: row.data || {}
    }));
  },

  getData: async (threadId) => {
    const key = String(threadId);
    const cached = threadCache.get(key);
    if (cached !== undefined) return cached;

    const existing = hasData("Threads", "threadId", threadId);
    if (!existing) {
      module.exports.createData(threadId, { ban: false, admin_only: false, support_only: false, box_only: false, prefix: global.config.prefix });
      logger.log("Da tao database cho nhom: " + threadId, "info");
    }
    const data = getData("Threads", "threadId", threadId);
    threadCache.set(key, data);
    return data;
  },

  setData: (threadId, data) => {
    const key = String(threadId);
    const record = { threadId: key, data: data || {} };
    const pending = saveData("Threads", "threadId", threadId, data || {});
    // Keep the same { threadId, data } envelope returned by JsonStore.get().
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

  createData: (threadId, defaultData = {}) => {
    const key = String(threadId);
    let record;
    if (!hasData("Threads", "threadId", threadId)) {
      const data = defaultData || {};
      record = { threadId: key, data };
      saveData("Threads", "threadId", threadId, data);
    } else {
      record = getData("Threads", "threadId", threadId);
    }
    threadCache.set(key, record);
    return record;
  }
};
