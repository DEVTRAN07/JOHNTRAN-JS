"use strict";

/**
 * Permission checks used by the command pipeline.
 * The common path returns synchronously. A Promise is created only when
 * box_only requires a live Zalo group-admin lookup.
 */
function checkCommandRole({ role = 0, isBotAdmin = false, isSupport = false } = {}) {
  if ((role === 2 && !isBotAdmin) || (role === 1 && !isBotAdmin && !isSupport)) {
    return { denied: "🚫 Bạn không có quyền sử dụng lệnh này." };
  }
  return { denied: null };
}

function evaluateGroupPermissions({
  isGroup,
  threadInfo,
  isBotAdmin = false,
  isSupport = false,
  isGroupAdmin = false
} = {}) {
  if (!isGroup) return { denied: null, isBotAdmin, isSupport, isGroupAdmin };

  if (threadInfo?.admin_only && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh." };
  }
  if (threadInfo?.support_only && !isSupport && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh." };
  }
  if (threadInfo?.box_only && !isGroupAdmin && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh." };
  }
  return { denied: null, isBotAdmin, isSupport, isGroupAdmin };
}

function checkGroupPermissions({
  api,
  threadId,
  isGroup,
  UIDUsage,
  threadInfo,
  isBotAdmin = false,
  isSupport = false,
  logger = console
} = {}) {
  // Most commands take this fast path: no API request and no Promise.
  if (!isGroup || !threadInfo?.box_only || isBotAdmin) {
    return evaluateGroupPermissions({ isGroup, threadInfo, isBotAdmin, isSupport });
  }

  let groupInfoRequest;
  try {
    groupInfoRequest = api.getGroupInfo(threadId);
  } catch (error) {
    logger.log?.("Không thể lấy thông tin nhóm từ API: " + error.message, "warn");
    return evaluateGroupPermissions({ isGroup, threadInfo, isBotAdmin, isSupport });
  }

  const applyGroupInfo = (info) => {
    const groupInfo = info?.gridInfoMap?.[threadId];
    const isGroupAdmin = Boolean(groupInfo && (
      groupInfo.creatorId == UIDUsage ||
      (Array.isArray(groupInfo.adminIds) && groupInfo.adminIds.includes(UIDUsage))
    ));
    return evaluateGroupPermissions({ isGroup, threadInfo, isBotAdmin, isSupport, isGroupAdmin });
  };

  if (groupInfoRequest && typeof groupInfoRequest.then === "function") {
    return Promise.resolve(groupInfoRequest)
      .then(applyGroupInfo)
      .catch((error) => {
        logger.log?.("Không thể lấy thông tin nhóm từ API: " + error.message, "warn");
        return evaluateGroupPermissions({ isGroup, threadInfo, isBotAdmin, isSupport });
      });
  }

  return applyGroupInfo(groupInfoRequest);
}

module.exports = { checkCommandRole, checkGroupPermissions, evaluateGroupPermissions };
