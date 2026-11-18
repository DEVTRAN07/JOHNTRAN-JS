"use strict";

const apiStates = new WeakMap();

const ROLE_CACHE_TTL_MS = 10000;
const UNKNOWN_CACHE_TTL_MS = 2500;
const GROUP_INFO_BATCH_SIZE = 20;
const GROUP_INFO_CONCURRENCY = 3;
const MAX_CACHED_GROUPS = 5000;

function getApiState(api) {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return null;
  let state = apiStates.get(api);
  if (!state) {
    state = { botId: "", botIdPromise: null, roles: new Map(), pending: new Map() };
    apiStates.set(api, state);
  }
  return state;
}

async function getBotId(api) {
  const state = getApiState(api);
  if (!state || typeof api.getOwnId !== "function") return "";
  if (state.botId) return state.botId;
  if (state.botIdPromise) return state.botIdPromise;

  state.botIdPromise = Promise.resolve()
    .then(() => api.getOwnId())
    .then(value => {
      state.botId = String(value || "").trim();
      return state.botId;
    })
    .catch(() => "")
    .finally(() => { state.botIdPromise = null; });
  return state.botIdPromise;
}

function getUncachedGroupInfo(api, groupId) {
  // core/message wraps APIs with Object.create(rawApi) and shadows getGroupInfo
  // with a five-minute cache. Read through the raw API prototype so an admin
  // demotion is observed on our short role-cache refresh instead of much later.
  let rawApi = null;
  try { rawApi = Object.getPrototypeOf(api); } catch {}
  const rawMethod = rawApi && typeof rawApi.getGroupInfo === "function"
    ? rawApi.getGroupInfo
    : null;
  if (rawMethod) return rawMethod.call(rawApi, groupId);
  return api.getGroupInfo(groupId);
}

function classifyBotGroupRole(groupInfo, botId) {
  const uid = String(botId || "").trim();
  if (!uid || !groupInfo || typeof groupInfo !== "object") return "unknown";
  if (groupInfo.creatorId != null && String(groupInfo.creatorId) === uid) return "owner";
  if (Array.isArray(groupInfo.adminIds) &&
      groupInfo.adminIds.some(id => String(id) === uid)) return "deputy";
  if (groupInfo.creatorId != null && Array.isArray(groupInfo.adminIds)) return "member";
  return "unknown";
}

function rememberRole(state, groupId, role, now = Date.now()) {
  const ttl = role === "unknown" ? UNKNOWN_CACHE_TTL_MS : ROLE_CACHE_TTL_MS;
  state.roles.delete(groupId);
  state.roles.set(groupId, { role, expiresAt: now + ttl });
  while (state.roles.size > MAX_CACHED_GROUPS) {
    const oldest = state.roles.keys().next().value;
    if (oldest === undefined) break;
    state.roles.delete(oldest);
  }
  return role;
}

async function getBotGroupRole(api, threadId, options = {}) {
  const groupId = String(threadId || "").trim();
  const state = getApiState(api);
  if (!groupId || !state || typeof api.getGroupInfo !== "function") return "unknown";

  const cached = state.roles.get(groupId);
  if (options.forceRefresh !== true && cached && cached.expiresAt > Date.now()) {
    return cached.role;
  }
  if (options.forceRefresh !== true && state.pending.has(groupId)) {
    return state.pending.get(groupId);
  }

  const request = Promise.resolve()
    .then(async () => {
      const [botId, response] = await Promise.all([
        getBotId(api),
        getUncachedGroupInfo(api, groupId)
      ]);
      const groupInfo = response?.gridInfoMap?.[groupId];
      return rememberRole(state, groupId, classifyBotGroupRole(groupInfo, botId));
    })
    .catch(() => rememberRole(state, groupId, "unknown"))
    .finally(() => {
      if (state.pending.get(groupId) === request) state.pending.delete(groupId);
    });

  state.pending.set(groupId, request);
  return request;
}

async function hasBotGroupKey(api, threadId, options = {}) {
  const role = await getBotGroupRole(api, threadId, options);
  return role === "owner" || role === "deputy";
}

function chunk(items, size) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const count = Math.min(items.length, Math.max(1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

/**
 * Inspect every group joined by the logged-in Zalo account.
 * groupIds may be supplied by a caller that already fetched getAllGroups().
 */
async function collectBotGroupKeys(api, options = {}) {
  if (!api || typeof api.getOwnId !== "function" || typeof api.getGroupInfo !== "function") {
    throw new Error("Zalo API không hỗ trợ kiểm tra quyền QTV nhóm.");
  }

  const botId = await getBotId(api);
  if (!botId) throw new Error("Không đọc được UID tài khoản Zalo của bot.");

  let groupIds = options.groupIds;
  if (!Array.isArray(groupIds)) {
    if (typeof api.getAllGroups !== "function") {
      throw new Error("Zalo API không hỗ trợ lấy danh sách nhóm.");
    }
    const response = await api.getAllGroups();
    groupIds = Object.keys(response?.gridVerMap || {});
  }
  groupIds = [...new Set(groupIds.map(id => String(id || "").trim()).filter(Boolean))];

  const batches = chunk(groupIds, GROUP_INFO_BATCH_SIZE);
  const batchResults = await mapWithConcurrency(
    batches,
    GROUP_INFO_CONCURRENCY,
    async batch => {
      try { return await getUncachedGroupInfo(api, batch); }
      catch { return null; }
    }
  );

  const groups = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const response = batchResults[batchIndex];
    for (const groupId of batch) {
      const info = response?.gridInfoMap?.[groupId] || null;
      const role = rememberRole(
        getApiState(api),
        groupId,
        classifyBotGroupRole(info, botId)
      );
      groups.push({
        gid: groupId,
        name: String(info?.name || ("Nhóm " + groupId.slice(-6))),
        avatar: String(info?.avt || info?.fullAvt || ""),
        totalMember: Number(info?.totalMember) || 0,
        role
      });
    }
  }

  const keyGroups = groups.filter(group => group.role === "owner" || group.role === "deputy");
  const noKeyGroups = groups.filter(group => group.role === "member");
  const unknownGroups = groups.filter(group => group.role === "unknown");
  return {
    botUid: botId,
    totalGroups: groupIds.length,
    allGroups: groups,
    keyGroups,
    noKeyGroups,
    unknownGroups,
    ownerCount: keyGroups.filter(group => group.role === "owner").length,
    deputyCount: keyGroups.filter(group => group.role === "deputy").length
  };
}

module.exports = {
  ROLE_CACHE_TTL_MS,
  UNKNOWN_CACHE_TTL_MS,
  GROUP_INFO_BATCH_SIZE,
  getBotId,
  classifyBotGroupRole,
  getBotGroupRole,
  hasBotGroupKey,
  collectBotGroupKeys
};
