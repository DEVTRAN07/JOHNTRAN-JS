"use strict";

/**
 * User-role policy and greeting text.
 * Configuration and runtime user lists are injectable for deterministic tests;
 * defaults preserve the legacy global.config/global.users contract.
 */
function normalizeUid(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function includesUid(list, uid) {
  const target = normalizeUid(uid);
  return Boolean(target && Array.isArray(list) && list.some(value => normalizeUid(value) === target));
}

function getAdminIds(config = global.config || {}, users = global.users || {}) {
  const runtimeAdmins = Array.isArray(users?.admin) ? users.admin : [];
  const configAdmins = Array.isArray(config?.admin_bot) ? config.admin_bot : [];
  return [...new Set([...configAdmins, ...runtimeAdmins].map(normalizeUid).filter(Boolean))];
}

function isBotAdmin(uid, config = global.config || {}, users = global.users || {}) {
  return includesUid(getAdminIds(config, users), uid);
}

function isSupportUser(uid, config = global.config || {}, users = global.users || {}) {
  const runtimeSupport = Array.isArray(users?.support) ? users.support : [];
  const configSupport = Array.isArray(config?.support_bot) ? config.support_bot : [];
  return includesUid([...runtimeSupport, ...configSupport], uid);
}

// admin_bot[0] is the primary owner. Runtime admin entries never promote a
// different account to bot owner.
function getBotOwnerId(config = global.config || {}) {
  const explicitOwner = normalizeUid(config?.owner_uid || config?.owner_id || config?.ownerId);
  if (explicitOwner) return explicitOwner;
  const configuredAdmins = Array.isArray(config?.admin_bot) ? config.admin_bot : [];
  return normalizeUid(configuredAdmins.find(value => normalizeUid(value)));
}

function isBotOwner(uid, config = global.config || {}) {
  const ownerId = getBotOwnerId(config);
  return Boolean(ownerId && ownerId === normalizeUid(uid));
}

function getRequesterGreeting(uid, config = global.config || {}, users = global.users || {}) {
  if (isBotOwner(uid, config)) return "🤖 Chào chủ nhân!";
  if (isBotAdmin(uid, config, users)) return "🛡️ Chào quản trị viên!";
  if (isSupportUser(uid, config, users)) return "✨ Chào trợ lý!";
  return "🤖 Chào bạn!";
}

function getRequesterPrompt(uid, config = global.config || {}, users = global.users || {}) {
  if (isBotOwner(uid, config)) return "👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
  if (isBotAdmin(uid, config, users)) return "👉 Mời quản trị viên chọn chức năng cần quản lý.";
  if (isSupportUser(uid, config, users)) return "👉 Bạn cần hỗ trợ tính năng nào? ✨";
  return "👉 Bạn muốn khám phá tính năng nào? 🚀";
}

module.exports = {
  normalizeUid, includesUid, getAdminIds, getBotOwnerId, isBotAdmin,
  isSupportUser, isBotOwner, getRequesterGreeting, getRequesterPrompt
};
