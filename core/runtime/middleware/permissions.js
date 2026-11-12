"use strict";

/**
 * Permission checks used by the command pipeline.
 * Transport-specific event types are passed in as a boolean so this module
 * does not need to import the Zalo SDK.
 */
function checkCommandRole({ role = 0, isBotAdmin = false, isSupport = false } = {}) {
  if ((role === 2 && !isBotAdmin) || (role === 1 && !isBotAdmin && !isSupport)) {
    return { denied: "🚫 Bạn không có quyền sử dụng lệnh này." };
  }
  return { denied: null };
}

async function checkGroupPermissions({
  api,
  threadId,
  isGroup,
  UIDUsage,
  threadInfo,
  isBotAdmin = false,
  isSupport = false,
  logger = console
} = {}) {
  let isGroupAdmin = false;

  if (isGroup) {
    if (threadInfo?.box_only && !isBotAdmin) {
      try {
        const info = await api.getGroupInfo(threadId);
        const groupInfo = info?.gridInfoMap?.[threadId];
        if (groupInfo) {
          isGroupAdmin = groupInfo.creatorId == UIDUsage
            || (Array.isArray(groupInfo.adminIds) && groupInfo.adminIds.includes(UIDUsage));
        }
      } catch (err) {
        logger.log?.("Không thể lấy thông tin nhóm từ API: " + err.message, "warn");
      }
    }

    if (threadInfo?.admin_only && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh." };
    }
    if (threadInfo?.support_only && !isSupport && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh." };
    }
    if (threadInfo?.box_only && !isGroupAdmin && !isBotAdmin) {
      return { denied: "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh." };
    }
  }

  return { denied: null, isBotAdmin, isSupport, isGroupAdmin };
}

module.exports = { checkCommandRole, checkGroupPermissions };
