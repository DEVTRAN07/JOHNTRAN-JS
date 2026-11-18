"use strict";

/**
 * true = confirmed creator/deputy
 * false = confirmed ordinary member
 * null = insufficient metadata or Zalo API failure
 *
 * A matching creatorId or adminIds entry independently proves QTV access.
 * A negative decision needs both fields to avoid misclassifying an unknown QTV.
 */
async function getGroupAdminState(api, threadId, userId) {
  if (!threadId || userId == null || String(userId) === "" ||
      typeof api?.getGroupInfo !== "function") return null;

  try {
    const response = await api.getGroupInfo(String(threadId));
    const group = response?.gridInfoMap?.[String(threadId)];
    if (!group) return null;

    const uid = String(userId);
    if (group.creatorId != null && String(group.creatorId) === uid) return true;
    if (Array.isArray(group.adminIds) &&
        group.adminIds.some(id => String(id) === uid)) return true;

    if (group.creatorId != null && Array.isArray(group.adminIds)) return false;
    return null;
  } catch {
    return null;
  }
}

module.exports = { getGroupAdminState };
