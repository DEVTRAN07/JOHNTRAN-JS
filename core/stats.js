"use strict";

// Panel stats are low-frequency data. Cache remote account/list calls and
// coalesce concurrent refreshes so slow Zalo APIs never stack up every tick.
const cache = require("./cache");
const logger = require("../utils/logger");

const PROFILE_CACHE_TTL = 300000;
const FRIENDS_CACHE_TTL = 300000;
const GROUPS_CACHE_TTL = 300000;
const MAX_LIST = 50;
const GROUP_INFO_CONCURRENCY = 4;

let profileCache = null;
let friendsCache = null;
let groupsCache = null;
let profileFlight = null;
let friendsFlight = null;
let groupsFlight = null;
let collectFlight = null;

function fresh(entry) {
  return Boolean(entry && entry.expiresAt > Date.now());
}

async function getProfile(api) {
  if (fresh(profileCache)) return profileCache.data;
  if (profileFlight) return profileFlight;

  profileFlight = (async () => {
    try {
      const [uid, info] = await Promise.all([
        api.getOwnId(),
        api.fetchAccountInfo()
      ]);
      const profile = info?.profile || {};
      const data = {
        uid: String(uid || profile.userId || ""),
        displayName: profile.displayName || profile.zaloName || "",
        avatar: profile.avatar || "",
        phoneNumber: profile.phoneNumber || "",
        status: profile.status || "",
        gender: profile.gender
      };
      profileCache = { expiresAt: Date.now() + PROFILE_CACHE_TTL, data };
      return data;
    } catch (error) {
      logger.log(`[stats] Không lấy được hồ sơ: ${error.message}`, "warn");
      return profileCache?.data || null;
    }
  })();

  try {
    return await profileFlight;
  } finally {
    profileFlight = null;
  }
}

async function getFriends(api) {
  if (fresh(friendsCache)) return friendsCache.data;
  if (friendsFlight) return friendsFlight;

  friendsFlight = (async () => {
    try {
      const friends = (await api.getAllFriends(500)) || [];
      const data = {
        total: friends.length,
        list: friends.slice(0, MAX_LIST).map((friend) => ({
          uid: String(friend.userId || ""),
          displayName: friend.displayName || "",
          avatar: friend.avatar || ""
        }))
      };
      friendsCache = { expiresAt: Date.now() + FRIENDS_CACHE_TTL, data };
      return data;
    } catch (error) {
      logger.log(`[stats] Không lấy được danh sách bạn bè: ${error.message}`, "warn");
      return friendsCache?.data || { total: 0, list: [] };
    }
  })();

  try {
    return await friendsFlight;
  } finally {
    friendsFlight = null;
  }
}

async function loadGroupInfo(api, gid) {
  try {
    return await cache.caches.groupInfo.remember(gid, () => api.getGroupInfo(gid));
  } catch {
    return null;
  }
}

async function getGroups(api) {
  if (fresh(groupsCache)) return groupsCache.data;
  if (groupsFlight) return groupsFlight;

  groupsFlight = (async () => {
    try {
      const { gridVerMap } = (await api.getAllGroups()) || {};
      const ids = Object.keys(gridVerMap || {});
      const selectedIds = ids.slice(0, MAX_LIST);
      const list = [];

      // Fetch a small bounded batch in parallel. This avoids up to 50
      // sequential network round trips while remaining gentle on Zalo APIs.
      for (let offset = 0; offset < selectedIds.length; offset += GROUP_INFO_CONCURRENCY) {
        const batch = selectedIds.slice(offset, offset + GROUP_INFO_CONCURRENCY);
        const results = await Promise.all(batch.map(gid => loadGroupInfo(api, gid)));
        for (let i = 0; i < results.length; i++) {
          const gid = batch[i];
          const group = results[i]?.gridInfoMap?.[gid];
          if (!group) continue;
          list.push({
            gid: String(gid),
            name: group.name || "",
            totalMember: group.totalMember || 0,
            avatar: group.avt || ""
          });
        }
      }

      const data = { total: ids.length, list };
      groupsCache = { expiresAt: Date.now() + GROUPS_CACHE_TTL, data };
      return data;
    } catch (error) {
      logger.log(`[stats] Không lấy được danh sách nhóm: ${error.message}`, "warn");
      return groupsCache?.data || { total: 0, list: [] };
    }
  })();

  try {
    return await groupsFlight;
  } finally {
    groupsFlight = null;
  }
}

async function collectStats(api) {
  if (collectFlight) return collectFlight;

  collectFlight = (async () => {
    const [profile, friends, groups] = await Promise.all([
      getProfile(api),
      getFriends(api),
      getGroups(api)
    ]);

    return {
      collectedAt: Date.now(),
      profile,
      friends,
      groups,
      process: {
        uptimeMs: process.uptime() * 1000,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        node: process.version,
        pid: process.pid
      }
    };
  })();

  try {
    return await collectFlight;
  } finally {
    collectFlight = null;
  }
}

function invalidate() {
  profileCache = null;
  friendsCache = null;
  groupsCache = null;
}

module.exports = {
  collectStats,
  invalidate,
  getFriends,
  getGroups,
  getProfile,
  PROFILE_CACHE_TTL,
  FRIENDS_CACHE_TTL,
  GROUPS_CACHE_TTL,
  GROUP_INFO_CONCURRENCY
};
