const { getData, saveData, hasData, delData, allData } = require("../runtime/adapters/database");
const logger = require("../../utils/logger");
const { userCache } = require("../cache");

const DEFAULT_USER = () => ({ ban: false });

module.exports = {
  getAll: () => {
    return allData("Users").map((row) => ({
      userId: row.userId,
      data: row.data || {}
    }));
  },

  // Synchronous mirror lookup for command dispatch. getData below retains
  // its Promise contract for legacy plugins that call .then()/.catch().
  getCachedData: (userId) => {
    const key = String(userId);
    const cached = userCache.get(key);
    if (cached !== undefined) return cached;
    try {
      let record = getData("Users", "userId", key);
      if (!record) record = saveData("Users", "userId", key, DEFAULT_USER());
      const data = record || { userId: key, data: DEFAULT_USER() };
      userCache.set(key, data);
      return data;
    } catch {
      return null;
    }
  },

  // Keep the historical Promise contract used by commands (.then/.catch),
  // while reading the in-memory database mirror immediately (no batch timer).
  getData: async (userId) => {
    const key = String(userId);
    const cached = userCache.get(key);
    if (cached !== undefined) return cached;

    if (!hasData("Users", "userId", userId)) {
      module.exports.createData(userId, DEFAULT_USER());
      logger.log("Da tao database cho nguoi dung: " + userId, "info");
    }
    const record = getData("Users", "userId", userId);
    const data = record || { userId: key, data: DEFAULT_USER() };
    userCache.set(key, data);
    return data;
  },

  setData: (userId, data) => {
    const key = String(userId);
    const record = saveData("Users", "userId", userId, data);
    userCache.set(key, record || { userId: key, data });
    return record;
  },

  delData: (userId) => {
    const key = String(userId);
    if (hasData("Users", "userId", userId)) {
      delData("Users", "userId", userId);
    }
    userCache.invalidate(key);
  },

  createData: (userId, defaultData = {}) => {
    const key = String(userId);
    let record = getData("Users", "userId", userId);
    if (!record) {
      record = saveData("Users", "userId", userId, defaultData);
    }
    userCache.set(key, record || { userId: key, data: defaultData });
    return record;
  },

  isBanned: async (userId) => {
    const record = await module.exports.getData(userId);
    return Boolean(record?.data?.ban);
  },

  setBan: async (userId, banned) => {
    const record = await module.exports.getData(userId);
    const data = { ...(record?.data || {}), ban: Boolean(banned) };
    module.exports.setData(userId, data);
    return data;
  }
};
