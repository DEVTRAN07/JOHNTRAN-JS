"use strict";

// Five-second cache balances lower API pressure with prompt visibility of role changes.
const ADMIN_CACHE_TTL_MS = 5000;
const UNKNOWN_CACHE_TTL_MS = 1000;
const MAX_CACHED_GROUPS = 2000;
const apiStates = new WeakMap();

function getApiOwner(api) {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return null;
  // wrapApi() creates Object.create(rawApi) wrappers for each incoming message.
  if (Object.prototype.hasOwnProperty.call(api, "__reply")) {
    try {
      const rawApi = Object.getPrototypeOf(api);
      if (rawApi && (typeof rawApi === "object" || typeof rawApi === "function")) return rawApi;
    } catch {}
  }
  return api;
}

function getState(api) {
  const owner = getApiOwner(api);
  if (!owner) return null;
  let state = apiStates.get(owner);
  if (!state) {
    state = { entries: new Map(), pending: new Map() };
    apiStates.set(owner, state);
  }
  return state;
}

function remember(state, groupId, group, now = Date.now()) {
  const snapshot = group ? {
    creatorId: group.creatorId == null ? null : String(group.creatorId),
    adminIds: Array.isArray(group.adminIds) ? group.adminIds.map(String) : null
  } : null;
  const complete = Boolean(snapshot && snapshot.creatorId != null && Array.isArray(snapshot.adminIds));
  const entry = {
    group: snapshot,
    expiresAt: now + (complete ? ADMIN_CACHE_TTL_MS : UNKNOWN_CACHE_TTL_MS)
  };
  state.entries.delete(groupId);
  state.entries.set(groupId, entry);
  while (state.entries.size > MAX_CACHED_GROUPS) {
    const oldest = state.entries.keys().next().value;
    if (oldest === undefined) break;
    state.entries.delete(oldest);
  }
  return entry;
}

function resolveState(entry, userId) {
  const group = entry?.group;
  if (!group) return null;
  const uid = String(userId);
  if (group.creatorId != null && group.creatorId === uid) return true;
  if (Array.isArray(group.adminIds) && group.adminIds.includes(uid)) return true;
  if (group.creatorId != null && Array.isArray(group.adminIds)) return false;
  return null;
}

/**
 * true = confirmed creator/deputy
 * false = confirmed ordinary member
 * null = insufficient metadata or Zalo API failure
 */
async function getGroupAdminState(api, threadId, userId) {
  const groupId = String(threadId || "").trim();
  const uid = userId == null ? "" : String(userId);
  const state = getState(api);
  if (!groupId || !uid || !state || typeof api?.getGroupInfo !== "function") return null;

  const now = Date.now();
  const cached = state.entries.get(groupId);
  if (cached && cached.expiresAt > now) {
    state.entries.delete(groupId);
    state.entries.set(groupId, cached);
    return resolveState(cached, uid);
  }

  let request = state.pending.get(groupId);
  if (!request) {
    request = Promise.resolve()
      .then(() => api.getGroupInfo(groupId))
      .then(response => {
        const group = response?.gridInfoMap?.[groupId] || null;
        return remember(state, groupId, group);
      })
      .catch(() => remember(state, groupId, null))
      .finally(() => {
        if (state.pending.get(groupId) === request) state.pending.delete(groupId);
      });
    state.pending.set(groupId, request);
  }

  const entry = await request;
  return resolveState(entry, uid);
}

function clearGroupAdminCache(api, threadId) {
  const state = getState(api);
  if (!state) return false;
  if (threadId == null) {
    state.entries.clear();
    return true;
  }
  return state.entries.delete(String(threadId));
}

module.exports = {
  ADMIN_CACHE_TTL_MS,
  UNKNOWN_CACHE_TTL_MS,
  getGroupAdminState,
  clearGroupAdminCache
};
