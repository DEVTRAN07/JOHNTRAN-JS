const { getData, saveData, hasData, delData, allData } = require("../../utils/db");
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

  getData: (userId) => {
    const key = String(userId);
    const cached = userCache.get(key);
    if (cached !== undefined) return cached;

    const existing = hasData("Users", "userId", userId);
    if (!existing) {
      module.exports.createData(userId, DEFAULT_USER());
      logger.log("Da tao database cho nguoi dung: " + userId, "info");
    }
    const data = getData("Users", "userId", userId);
    userCache.set(key, data);
    return data;
  },

  setData: (userId, data) => {
    const key = String(userId);
    saveData("Users", "userId", userId, data);
    userCache.set(key, data);
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
    if (!hasData("Users", "userId", userId)) {
      saveData("Users", "userId", userId, defaultData);
    }
    userCache.set(key, defaultData);
  },

  isBanned: (userId) => {
    const record = getData("Users", "userId", userId);
    return Boolean(record?.data?.ban);
  },

  setBan: (userId, banned) => {
    const data = module.exports.getData(userId).data || {};
    data.ban = Boolean(banned);
    module.exports.setData(userId, data);
  }
};
