"use strict";

const nativeCore = require("../../../native");

/**
 * User-role policy and greeting text.
 * Configuration and runtime user lists are injectable for deterministic tests;
 * defaults preserve the legacy global.config/global.users contract.
 */
function normalizeUidFallback(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function includesUidFallback(list, uid) {
  const target = normalizeUidFallback(uid);
  return Boolean(target && Array.isArray(list) && list.some(value => normalizeUidFallback(value) === target));
}

function getAdminIdsFallback(config = global.config || {}, users = global.users || {}) {
  const runtimeAdmins = Array.isArray(users?.admin) ? users.admin : [];
  const configAdmins = Array.isArray(config?.admin_bot) ? config.admin_bot : [];
  return [...new Set([...configAdmins, ...runtimeAdmins].map(normalizeUidFallback).filter(Boolean))];
}

function isBotAdminFallback(uid, config = global.config || {}, users = global.users || {}) {
  return includesUidFallback(getAdminIdsFallback(config, users), uid);
}

function isSupportUserFallback(uid, config = global.config || {}, users = global.users || {}) {
  const runtimeSupport = Array.isArray(users?.support) ? users.support : [];
  const configSupport = Array.isArray(config?.support_bot) ? config.support_bot : [];
  return includesUidFallback([...runtimeSupport, ...configSupport], uid);
}

// admin_bot[0] is the primary owner. Runtime admin entries never promote a
// different account to bot owner.
function getBotOwnerIdFallback(config = global.config || {}) {
  const explicitOwner = normalizeUidFallback(config?.owner_uid || config?.owner_id || config?.ownerId);
  if (explicitOwner) return explicitOwner;
  const configuredAdmins = Array.isArray(config?.admin_bot) ? config.admin_bot : [];
  return normalizeUidFallback(configuredAdmins.find(value => normalizeUidFallback(value)));
}

function isBotOwnerFallback(uid, config = global.config || {}) {
  const ownerId = getBotOwnerIdFallback(config);
  return Boolean(ownerId && ownerId === normalizeUidFallback(uid));
}

function getRequesterGreetingFallback(uid, config = global.config || {}, users = global.users || {}) {
  if (isBotOwnerFallback(uid, config)) return "🤖 Chào chủ nhân!";
  if (isBotAdminFallback(uid, config, users)) return "🛡️ Chào quản trị viên!";
  if (isSupportUserFallback(uid, config, users)) return "✨ Chào trợ lý!";
  return "🤖 Chào bạn!";
}

function getRequesterPromptFallback(uid, config = global.config || {}, users = global.users || {}) {
  if (isBotOwnerFallback(uid, config)) return "👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
  if (isBotAdminFallback(uid, config, users)) return "👉 Mời quản trị viên chọn chức năng cần quản lý.";
  if (isSupportUserFallback(uid, config, users)) return "👉 Bạn cần hỗ trợ tính năng nào? ✨";
  return "👉 Bạn muốn khám phá tính năng nào? 🚀";
}


function requesterString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function requesterArray(values) {
  return Array.isArray(values) ? values.map(requesterString) : [];
}

function requesterConfig(config) {
  return config || {};
}

function requesterUsers(users) {
  return users || {};
}

function requesterInputs(uid, config = global.config || {}, users = global.users || {}) {
  const safeConfig = requesterConfig(config);
  const safeUsers = requesterUsers(users);
  const explicitOwner = safeConfig?.owner_uid || safeConfig?.owner_id || safeConfig?.ownerId;
  return {
    uid: requesterString(uid),
    explicitOwner: requesterString(explicitOwner),
    configAdmins: requesterArray(safeConfig?.admin_bot),
    runtimeAdmins: requesterArray(safeUsers?.admin),
    runtimeSupport: requesterArray(safeUsers?.support),
    configSupport: requesterArray(safeConfig?.support_bot)
  };
}

function callRequesterNative(operation, args = []) {
  return nativeCore.tryRequesterOperation(operation, args);
}

function normalizeUid(value) {
  const result = callRequesterNative("requester_normalize_uid", [requesterString(value)]);
  if (result.used && typeof result.value === "string") return result.value;
  return normalizeUidFallback(value);
}

function includesUid(list, uid) {
  if (!Array.isArray(list)) return false;
  const result = callRequesterNative("requester_includes_uid", [
    requesterArray(list),
    requesterString(uid)
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : includesUidFallback(list, uid);
}

function getAdminIds(config = global.config || {}, users = global.users || {}) {
  const inputs = requesterInputs("", config, users);
  const result = callRequesterNative("requester_get_admin_ids", [
    inputs.configAdmins,
    inputs.runtimeAdmins
  ]);
  return result.used && Array.isArray(result.value)
    ? result.value.map(String)
    : getAdminIdsFallback(config, users);
}

function isBotAdmin(uid, config = global.config || {}, users = global.users || {}) {
  const inputs = requesterInputs(uid, config, users);
  const result = callRequesterNative("requester_is_bot_admin", [
    inputs.uid,
    inputs.configAdmins,
    inputs.runtimeAdmins
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isBotAdminFallback(uid, config, users);
}

function isSupportUser(uid, config = global.config || {}, users = global.users || {}) {
  const inputs = requesterInputs(uid, config, users);
  const result = callRequesterNative("requester_is_support_user", [
    inputs.uid,
    inputs.runtimeSupport,
    inputs.configSupport
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isSupportUserFallback(uid, config, users);
}

function getBotOwnerId(config = global.config || {}) {
  const safeConfig = requesterConfig(config);
  const explicitOwner = safeConfig?.owner_uid || safeConfig?.owner_id || safeConfig?.ownerId;
  const result = callRequesterNative("requester_get_bot_owner_id", [
    requesterString(explicitOwner),
    requesterArray(safeConfig?.admin_bot)
  ]);
  return result.used && typeof result.value === "string"
    ? result.value
    : getBotOwnerIdFallback(config);
}

function isBotOwner(uid, config = global.config || {}) {
  const inputs = requesterInputs(uid, config);
  const result = callRequesterNative("requester_is_bot_owner", [
    inputs.uid,
    inputs.explicitOwner,
    inputs.configAdmins
  ]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : isBotOwnerFallback(uid, config);
}

function getRequesterRole(uid, config = global.config || {}, users = global.users || {}) {
  const inputs = requesterInputs(uid, config, users);
  const result = callRequesterNative("requester_role", [
    inputs.uid,
    inputs.explicitOwner,
    inputs.configAdmins,
    inputs.runtimeAdmins,
    inputs.runtimeSupport,
    inputs.configSupport
  ]);
  if (result.used && ["owner", "admin", "support", "member"].includes(result.value)) {
    return result.value;
  }
  if (isBotOwnerFallback(uid, config)) return "owner";
  if (isBotAdminFallback(uid, config, users)) return "admin";
  if (isSupportUserFallback(uid, config, users)) return "support";
  return "member";
}

function getRequesterGreeting(uid, config = global.config || {}, users = global.users || {}) {
  switch (getRequesterRole(uid, config, users)) {
    case "owner": return "🤖 Chào chủ nhân!";
    case "admin": return "🛡️ Chào quản trị viên!";
    case "support": return "✨ Chào trợ lý!";
    default: return "🤖 Chào bạn!";
  }
}

function getRequesterPrompt(uid, config = global.config || {}, users = global.users || {}) {
  switch (getRequesterRole(uid, config, users)) {
    case "owner": return "👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
    case "admin": return "👉 Mời quản trị viên chọn chức năng cần quản lý.";
    case "support": return "👉 Bạn cần hỗ trợ tính năng nào? ✨";
    default: return "👉 Bạn muốn khám phá tính năng nào? 🚀";
  }
}

module.exports = {
  normalizeUid, includesUid, getAdminIds, getBotOwnerId, isBotAdmin,
  isSupportUser, isBotOwner, getRequesterGreeting, getRequesterPrompt,
  getRequesterRole,
  getNativeDiagnostics: nativeCore.getRequesterGreetingDiagnostics,
  __test: {
    normalizeUidFallback, includesUidFallback, getAdminIdsFallback,
    getBotOwnerIdFallback, isBotAdminFallback, isSupportUserFallback,
    isBotOwnerFallback, getRequesterGreetingFallback, getRequesterPromptFallback
  }
};
