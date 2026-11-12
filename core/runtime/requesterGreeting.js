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

// admin_bot[0] is the primary owner. The remaining IDs are administrators;
// a runtime admin entry alone must never promote someone to bot owner.
function getBotOwnerId() {
  const config = global.config || {};
  const explicitOwner = normalizeUid(config.owner_uid || config.owner_id || config.ownerId);
  if (explicitOwner) return explicitOwner;
  const configuredAdmins = Array.isArray(config.admin_bot) ? config.admin_bot : [];
  return normalizeUid(configuredAdmins.find(value => normalizeUid(value)));
}

function isBotOwner(uid) {
  const ownerId = getBotOwnerId();
  return Boolean(ownerId && ownerId === normalizeUid(uid));
}

function getRequesterGreeting(uid) {
  if (isBotOwner(uid)) return "🤖 Chào chủ nhân!";
  if (isBotAdmin(uid)) return "🛡️ Chào quản trị viên!";
  if (isSupportUser(uid)) return "✨ Chào trợ lý!";
  return "🤖 Chào bạn!";
}

function getRequesterPrompt(uid) {
  if (isBotOwner(uid)) return "👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
  if (isBotAdmin(uid)) return "👉 Mời quản trị viên chọn chức năng cần quản lý.";
  if (isSupportUser(uid)) return "👉 Bạn cần hỗ trợ tính năng nào? ✨";
  return "👉 Bạn muốn khám phá tính năng nào? 🚀";
}

module.exports = {
  normalizeUid, includesUid, getAdminIds, getBotOwnerId, isBotAdmin,
  isSupportUser, isBotOwner, getRequesterGreeting, getRequesterPrompt
};
