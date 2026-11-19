"use strict";

const { TRIT, fromBoolean, isTrue } = require("../trit");
const { getGroupAdminState } = require("../groupAdmin");

/**
 * Permission checks used by the command pipeline.
 * Group-admin verification is a genuine three-state decision:
 * unknown (-1), not admin (0), admin (1).
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
  groupAdminState = TRIT.UNKNOWN
} = {}) {
  // Group-level restrictions must never leak into private conversations.
  if (isGroup === false) {
    return { denied: null, isBotAdmin, isSupport, isGroupAdmin: false };
  }
  if (threadInfo?.admin_only && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh." };
  }
  if (threadInfo?.support_only && !isSupport && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh." };
  }
  if (threadInfo?.box_only && !isTrue(groupAdminState) && !isBotAdmin) {
    return { denied: "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh." };
  }
  return {
    denied: null,
    isBotAdmin,
    isSupport,
    isGroupAdmin: isTrue(groupAdminState)
  };
}

function resolveGroupAdminState(groupInfo, UIDUsage) {
  if (!groupInfo) return TRIT.UNKNOWN;
  const hasUserId = UIDUsage !== undefined && UIDUsage !== null && UIDUsage !== "";
  const isAdmin = hasUserId && (
    groupInfo.creatorId == UIDUsage ||
    (Array.isArray(groupInfo.adminIds) && groupInfo.adminIds.includes(UIDUsage))
  );
  return fromBoolean(isAdmin);
}

function checkGroupPermissions({
  api,
  threadId,
  isGroup,
  UIDUsage,
  threadInfo,
  isBotAdmin = false,
  isSupport = false,
  isGroupAdmin = false,
  logger = console
} = {}) {
  // Most commands take this synchronous path: no API request and no Promise.
  if (!isGroup || !threadInfo?.box_only || isBotAdmin) {
    return evaluateGroupPermissions({ isGroup, threadInfo, isBotAdmin, isSupport });
  }

  // Zalo may include an explicit admin marker on the incoming group message.
  // Guard already trusts these positive markers. Reuse the same confirmed
  // signal here so box_only does not issue an extra getGroupInfo request for
  // every command sent by a known group admin. Never infer admin from a
  // missing/false marker; those users keep the live verification path.
  if (isGroupAdmin === true) {
    return evaluateGroupPermissions({
      isGroup,
      threadInfo,
      isBotAdmin,
      isSupport,
      groupAdminState: TRIT.TRUE
    });
  }

  const applyGroupAdminState = state => evaluateGroupPermissions({
    isGroup,
    threadInfo,
    isBotAdmin,
    isSupport,
    groupAdminState: state === true
      ? TRIT.TRUE
      : state === false ? TRIT.FALSE : TRIT.UNKNOWN
  });

  // The short-lived per-session cache also coalesces simultaneous command
  // checks that need the same group's creator/deputy list.
  return getGroupAdminState(api, threadId, UIDUsage)
    .then(applyGroupAdminState)
    .catch(error => {
      logger.log?.("Không thể lấy thông tin nhóm từ API: " + (error?.message || error), "warn");
      return applyGroupAdminState(null);
    });
}

module.exports = {
  checkCommandRole,
  checkGroupPermissions,
  evaluateGroupPermissions,
  resolveGroupAdminState
};
