"use strict";

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

module.exports = {
  isEnabled,
  isAllowedControl,
  isAllowedControlMessage,
  canRunCommandInGroup
};
