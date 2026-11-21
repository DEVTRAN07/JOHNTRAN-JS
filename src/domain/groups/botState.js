"use strict";

const nativeCore = require("../../../native");

/**
 * Group-level bot policy.
 *
 * Pure domain functions only: no Zalo SDK, database, filesystem or timers.
 * Callers provide the already-cached group snapshot so this module is safe
 * to use from the message hot path.
 */
function isEnabledFallback(threadOrData) {
  const data = threadOrData?.data && typeof threadOrData.data === "object"
    ? threadOrData.data
    : threadOrData;
  return data?.bot_enabled === true;
}

function isAllowedControlFallback(commandName, args = []) {
  return String(commandName || "").trim().toLowerCase() === "bot" &&
    ["on", "status"].includes(String(args?.[0] || "").trim().toLowerCase());
}

function isAllowedControlMessageFallback(content, prefix) {
  if (typeof content !== "string" || typeof prefix !== "string" || !prefix) return false;
  if (!content.startsWith(prefix)) return false;
  const parts = content.slice(prefix.length).trim().split(/\s+/);
  return isAllowedControlFallback(parts.shift() || "", parts);
}

function canRunCommandInGroupFallback(threadInfo, commandName, args = []) {
  return isEnabledFallback(threadInfo) || isAllowedControlFallback(commandName, args);
}

function attachGroupBotStateFallback(groups, threadRecords) {
  const enabledIds = new Set(
    (Array.isArray(threadRecords) ? threadRecords : [])
      .filter(record => isEnabledFallback(record))
      .map(record => String(record?.threadId || record?.id || ""))
      .filter(Boolean)
  );
  return (Array.isArray(groups) ? groups : []).map(group => ({
    ...group,
    botEnabled: enabledIds.has(String(group?.gid || ""))
  }));
}

function getGroupBotStateSnapshotFallback(threadRecords) {
  return (Array.isArray(threadRecords) ? threadRecords : [])
    .map(record => ({
      gid: String(record?.threadId || record?.id || ""),
      botEnabled: isEnabledFallback(record)
    }))
    .filter(record => record.gid);
}


function callGroupStateNative(operation, args = []) {
  return nativeCore.tryGroupStateOperation(operation, args);
}

function isEnabled(threadOrData) {
  const data = threadOrData?.data && typeof threadOrData.data === "object"
    ? threadOrData.data
    : threadOrData;
  const enabled = data?.bot_enabled === true;
  const result = callGroupStateNative("group_is_enabled", [enabled]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isEnabledFallback(threadOrData);
}

function isAllowedControl(commandName, args = []) {
  const result = callGroupStateNative("group_is_allowed_control", [
    String(commandName || ""),
    String(args?.[0] || "")
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isAllowedControlFallback(commandName, args);
}

function isAllowedControlMessage(content, prefix) {
  if (typeof content !== "string" || typeof prefix !== "string" || !prefix) return false;
  const result = callGroupStateNative("group_is_allowed_control_message", [content, prefix]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isAllowedControlMessageFallback(content, prefix);
}

function canRunCommandInGroup(threadInfo, commandName, args = []) {
  const enabled = isEnabledFallback(threadInfo);
  const result = callGroupStateNative("group_can_run_command", [
    enabled,
    String(commandName || ""),
    String(args?.[0] || "")
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : canRunCommandInGroupFallback(threadInfo, commandName, args);
}

function attachGroupBotState(groups, threadRecords) {
  const groupList = Array.isArray(groups) ? groups : [];
  const records = Array.isArray(threadRecords) ? threadRecords : [];
  const enabledIds = records
    .filter(record => isEnabledFallback(record))
    .map(record => String(record?.threadId || record?.id || ""))
    .filter(Boolean);
  const groupIds = groupList.map(group => String(group?.gid || ""));
  const result = callGroupStateNative("group_enabled_flags", [enabledIds, groupIds]);
  if (result.used && Array.isArray(result.value) && result.value.length === groupList.length &&
      result.value.every(value => typeof value === "boolean")) {
    return groupList.map((group, index) => ({
      ...group,
      botEnabled: result.value[index]
    }));
  }
  return attachGroupBotStateFallback(groups, threadRecords);
}

function getGroupBotStateSnapshot(threadRecords) {
  const records = Array.isArray(threadRecords) ? threadRecords : [];
  const gids = records.map(record => String(record?.threadId || record?.id || ""));
  const enabledFlags = records.map(record => isEnabledFallback(record));
  const result = callGroupStateNative("group_state_snapshot", [gids, enabledFlags]);
  if (result.used && Array.isArray(result.value)) {
    const snapshot = result.value.map(item => ({
      gid: String(item?.gid || ""),
      botEnabled: item?.botEnabled === true || item?.bot_enabled === true
    })).filter(item => item.gid);
    if (snapshot.length === gids.filter(Boolean).length) return snapshot;
  }
  return getGroupBotStateSnapshotFallback(threadRecords);
}

module.exports = {
  isEnabled,
  isAllowedControl,
  isAllowedControlMessage,
  canRunCommandInGroup,
  attachGroupBotState,
  getGroupBotStateSnapshot,
  getNativeDiagnostics: nativeCore.getGroupStateDiagnostics,
  __test: { isEnabledFallback, isAllowedControlFallback, isAllowedControlMessageFallback,
    canRunCommandInGroupFallback, attachGroupBotStateFallback, getGroupBotStateSnapshotFallback }
};
