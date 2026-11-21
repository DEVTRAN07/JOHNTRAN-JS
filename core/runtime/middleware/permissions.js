"use strict";

const nativeCore = require("../../../native");

const { TRIT, fromBoolean, isTrue } = require("../trit");
const { getGroupAdminState } = require("../groupAdmin");

/**
 * Permission checks used by the command pipeline.
 * Group-admin verification is a genuine three-state decision:
 * unknown (-1), not admin (0), admin (1).
 * The common path returns synchronously. A Promise is created only when
 * box_only requires a live Zalo group-admin lookup.
 */
function checkCommandRoleFallback({ role = 0, isBotAdmin = false, isSupport = false } = {}) {
  if ((role === 2 && !isBotAdmin) || (role === 1 && !isBotAdmin && !isSupport)) {
    return { denied: "🚫 Bạn không có quyền sử dụng lệnh này." };
  }
  return { denied: null };
}

function evaluateGroupPermissionsFallback({
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

function resolveGroupAdminStateFallback(groupInfo, UIDUsage) {
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


const ROLE_DENIED_MESSAGE = "🚫 Bạn không có quyền sử dụng lệnh này.";
const GROUP_DENIED_MESSAGES = Object.freeze({
  1: "❌ Nhóm đã bật chế độ chỉ admin bot được dùng lệnh.",
  2: "❌ Nhóm đã bật chế độ chỉ support bot hoặc admin bot được dùng lệnh.",
  3: "❌ Nhóm đã bật chế độ chỉ trưởng nhóm hoặc phó nhóm được dùng lệnh."
});

function checkCommandRole({ role = 0, isBotAdmin = false, isSupport = false } = {}) {
  const result = nativeCore.tryPermissionPolicyOperation("permission_check_command_role", [
    role === 2,
    role === 1,
    Boolean(isBotAdmin),
    Boolean(isSupport)
  ]);
  if (result.used && typeof result.value === "boolean") {
    return { denied: result.value ? ROLE_DENIED_MESSAGE : null };
  }
  return checkCommandRoleFallback({ role, isBotAdmin, isSupport });
}

function evaluateGroupPermissions({
  isGroup,
  threadInfo,
  isBotAdmin = false,
  isSupport = false,
  groupAdminState = TRIT.UNKNOWN
} = {}) {
  const isPrivateMessage = isGroup === false;
  const isAdminOnly = Boolean(threadInfo?.admin_only);
  const isSupportOnly = Boolean(threadInfo?.support_only);
  const isBoxOnly = Boolean(threadInfo?.box_only);
  const isBotAdminFlag = Boolean(isBotAdmin);
  const isSupportFlag = Boolean(isSupport);
  const isGroupAdminFlag = groupAdminState === TRIT.TRUE;
  const result = nativeCore.tryPermissionPolicyOperation("permission_evaluate_group", [
    isPrivateMessage,
    isAdminOnly,
    isSupportOnly,
    isBoxOnly,
    isBotAdminFlag,
    isSupportFlag,
    isGroupAdminFlag
  ]);
  if (result.used && Number.isInteger(result.value)) {
    if (result.value === 0) {
      return {
        denied: null,
        isBotAdmin,
        isSupport,
        isGroupAdmin: isPrivateMessage ? false : isGroupAdminFlag
      };
    }
    if (GROUP_DENIED_MESSAGES[result.value]) {
      return { denied: GROUP_DENIED_MESSAGES[result.value] };
    }
  }
  return evaluateGroupPermissionsFallback({
    isGroup, threadInfo, isBotAdmin, isSupport, groupAdminState
  });
}

function resolveGroupAdminState(groupInfo, UIDUsage) {
  const groupInfoPresent = Boolean(groupInfo);
  let hasUserId = false;
  let creatorMatches = false;
  let adminListMatches = false;

  if (groupInfoPresent) {
    hasUserId = UIDUsage !== undefined && UIDUsage !== null && UIDUsage !== "";
    if (hasUserId) {
      // Preserve the legacy loose creatorId comparison and strict includes
      // behaviour for adminIds before handing the final policy to Rust.
      creatorMatches = groupInfo.creatorId == UIDUsage;
      if (!creatorMatches) {
        adminListMatches = Array.isArray(groupInfo.adminIds) &&
          groupInfo.adminIds.includes(UIDUsage);
      }
    }
  }

  const fallbackState = !groupInfoPresent
    ? TRIT.UNKNOWN
    : fromBoolean(hasUserId && (creatorMatches || adminListMatches));
  const result = nativeCore.tryPermissionPolicyOperation("permission_resolve_group_admin_state", [
    groupInfoPresent,
    hasUserId,
    creatorMatches,
    adminListMatches
  ]);
  return result.used && [-1, 0, 1].includes(result.value)
    ? result.value
    : fallbackState;
}

module.exports = {
  checkCommandRole,
  checkGroupPermissions,
  evaluateGroupPermissions,
  resolveGroupAdminState,
  getNativeDiagnostics: nativeCore.getPermissionPolicyDiagnostics,
  __test: { checkCommandRoleFallback, evaluateGroupPermissionsFallback, resolveGroupAdminStateFallback }
};
