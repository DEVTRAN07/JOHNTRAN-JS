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
    saveData("Threads", "threadId", threadId, data);
    threadCache.set(key, data);
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
    if (!hasData("Threads", "threadId", threadId)) {
      saveData("Threads", "threadId", threadId, defaultData);
    }
    threadCache.set(key, defaultData);
  }
};
