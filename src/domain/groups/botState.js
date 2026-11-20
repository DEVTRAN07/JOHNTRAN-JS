"use strict";

/**
 * Group-level bot policy.
 *
 * Pure domain functions only: no Zalo SDK, database, filesystem or timers.
 * Callers provide the already-cached group snapshot so this module is safe
 * to use from the message hot path.
 */
function isEnabled(threadOrData) {
  const data = threadOrData?.data && typeof threadOrData.data === "object"
    ? threadOrData.data
    : threadOrData;
  return data?.bot_enabled === true;
}

function isAllowedControl(commandName, args = []) {
  return String(commandName || "").trim().toLowerCase() === "bot" &&
    ["on", "status"].includes(String(args?.[0] || "").trim().toLowerCase());
}

function isAllowedControlMessage(content, prefix) {
  if (typeof content !== "string" || typeof prefix !== "string" || !prefix) return false;
  if (!content.startsWith(prefix)) return false;
  const parts = content.slice(prefix.length).trim().split(/\s+/);
  return isAllowedControl(parts.shift() || "", parts);
}

function canRunCommandInGroup(threadInfo, commandName, args = []) {
  return isEnabled(threadInfo) || isAllowedControl(commandName, args);
}

function attachGroupBotState(groups, threadRecords) {
  const enabledIds = new Set(
    (Array.isArray(threadRecords) ? threadRecords : [])
      .filter(record => isEnabled(record))
      .map(record => String(record?.threadId || record?.id || ""))
      .filter(Boolean)
  );
  return (Array.isArray(groups) ? groups : []).map(group => ({
    ...group,
    botEnabled: enabledIds.has(String(group?.gid || ""))
  }));
}

function getGroupBotStateSnapshot(threadRecords) {
  return (Array.isArray(threadRecords) ? threadRecords : [])
    .map(record => ({
      gid: String(record?.threadId || record?.id || ""),
      botEnabled: isEnabled(record)
    }))
    .filter(record => record.gid);
}

module.exports = {
  isEnabled,
  isAllowedControl,
  isAllowedControlMessage,
  canRunCommandInGroup,
  attachGroupBotState,
  getGroupBotStateSnapshot
};
