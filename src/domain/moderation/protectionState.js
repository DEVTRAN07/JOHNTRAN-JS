"use strict";

const nativeCore = require("../../../native");

/**
 * Anti-protection settings schema.
 * This module contains only deterministic state mapping and validation;
 * Zalo permissions, persistence and notices remain in application adapters.
 */
const ANTI_PROTECTION_KEYS = Object.freeze([
  "anti_nude", "anti_undo", "anti_danger_link", "anti_sticker_spam", "anti_link", "anti_spam",
  "anti_card", "anti_doodle", "anti_file", "anti_gif", "anti_join", "anti_location",
  "anti_other", "anti_photo", "anti_qr", "anti_reaction", "anti_sticker", "anti_taghide",
  "anti_video", "anti_voice", "anti_word"
]);
const KEY_SET = new Set(ANTI_PROTECTION_KEYS);

function getAntiProtectionStateFallback(threadData = {}) {
  const data = threadData && typeof threadData === "object" ? threadData : {};
  return Object.fromEntries(ANTI_PROTECTION_KEYS.map(key => [key, data[key] === true]));
}

function setAntiProtectionStateFallback(threadData, feature, enabled) {
  if (!KEY_SET.has(feature)) throw new Error("Tính năng bảo vệ không hợp lệ");
  if (typeof enabled !== "boolean") throw new TypeError("enabled phải là boolean (true hoặc false)");
  if (!threadData || typeof threadData !== "object" || Array.isArray(threadData)) {
    throw new TypeError("Dữ liệu nhóm không hợp lệ");
  }
  threadData[feature] = enabled;
  return getAntiProtectionStateFallback(threadData);
}

function isSupportedFeature(feature) {
  if (typeof feature !== "string") return KEY_SET.has(feature);
  const result = nativeCore.tryAntiProtectionOperation("anti_is_supported_feature", [feature]);
  return result.used && typeof result.value === "boolean"
    ? result.value
    : KEY_SET.has(feature);
}

function getAntiProtectionState(threadData = {}) {
  const data = threadData && typeof threadData === "object" ? threadData : {};
  const flags = ANTI_PROTECTION_KEYS.map(key => data[key] === true);
  const result = nativeCore.tryAntiProtectionOperation("anti_protection_state", [flags]);
  if (result.used && Array.isArray(result.value) && result.value.length === ANTI_PROTECTION_KEYS.length) {
    const entries = result.value;
    const valid = entries.every((entry, index) =>
      entry &&
      entry.key === ANTI_PROTECTION_KEYS[index] &&
      typeof entry.enabled === "boolean"
    );
    if (valid) {
      return Object.fromEntries(entries.map(entry => [entry.key, entry.enabled]));
    }
  }
  return getAntiProtectionStateFallback(threadData);
}

function setAntiProtectionState(threadData, feature, enabled) {
  if (!isSupportedFeature(feature)) throw new Error("Tính năng bảo vệ không hợp lệ");
  if (typeof enabled !== "boolean") throw new TypeError("enabled phải là boolean (true hoặc false)");
  if (!threadData || typeof threadData !== "object" || Array.isArray(threadData)) {
    throw new TypeError("Dữ liệu nhóm không hợp lệ");
  }
  threadData[feature] = enabled;
  return getAntiProtectionState(threadData);
}

module.exports = {
  ANTI_PROTECTION_KEYS,
  isSupportedFeature,
  getAntiProtectionState,
  setAntiProtectionState,
  getNativeDiagnostics: nativeCore.getAntiProtectionDiagnostics,
  __test: { getAntiProtectionStateFallback, setAntiProtectionStateFallback }
};
