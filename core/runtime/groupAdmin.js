"use strict";

/**
 * Three-state group-admin lookup:
 * true  = confirmed creator/admin
 * false = confirmed ordinary member
 * null  = missing/partial metadata or API failure
 *
 * Moderation features should act only on false; unknown must fail safe.
 */
async function getGroupAdminState(api, threadId, userId) {
  if (!threadId || userId == null || String(userId) === "" ||
      typeof api?.getGroupInfo !== "function") return null;
  try {
    const response = await api.getGroupInfo(String(threadId));
    const group = response?.gridInfoMap?.[String(threadId)];
    if (!group || group.creatorId == null || !Array.isArray(group.adminIds)) return null;
    const uid = String(userId);
    if (String(group.creatorId) === uid ||
        group.adminIds.some(id => String(id) === uid)) return true;
    return false;
  } catch {
    return null;
  }
}

module.exports = { getGroupAdminState };
