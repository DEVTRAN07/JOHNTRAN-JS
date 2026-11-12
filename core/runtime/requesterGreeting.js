"use strict";

function normalizeUid(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function includesUid(list, uid) {
  const target = normalizeUid(uid);
  return Boolean(target && Array.isArray(list) && list.some(value => normalizeUid(value) === target));
}

function getAdminIds() {
  const runtimeAdmins = Array.isArray(global.users?.admin) ? global.users.admin : [];
  const configAdmins = Array.isArray(global.config?.admin_bot) ? global.config.admin_bot : [];
  return [...new Set([...configAdmins, ...runtimeAdmins].map(normalizeUid).filter(Boolean))];
}

function isBotAdmin(uid) {
  return includesUid(getAdminIds(), uid);
}

function isSupportUser(uid) {
  const runtimeSupport = Array.isArray(global.users?.support) ? global.users.support : [];
  const configSupport = Array.isArray(global.config?.support_bot) ? global.config.support_bot : [];
  return includesUid([...runtimeSupport, ...configSupport], uid);
}

function isBotOwner(uid) {
  const configAdmins = Array.isArray(global.config?.admin_bot) ? global.config.admin_bot : [];
  const runtimeAdmins = Array.isArray(global.users?.admin) ? global.users.admin : [];
  const ownerId = normalizeUid(configAdmins.find(value => normalizeUid(value)) ??
    runtimeAdmins.find(value => normalizeUid(value)));
  return Boolean(ownerId && ownerId === normalizeUid(uid));
}

function getRequesterGreeting(uid) {
  if (isBotOwner(uid)) return "👑 Chào chủ nhân!";
  if (isBotAdmin(uid)) return "🛡️ Chào quản trị viên!";
  if (isSupportUser(uid)) return "✨ Chào trợ lý!";
  return "🤖 Chào bạn!";
}

module.exports = {
  normalizeUid,
  includesUid,
  getAdminIds,
  isBotAdmin,
  isSupportUser,
  isBotOwner,
  getRequesterGreeting
};
