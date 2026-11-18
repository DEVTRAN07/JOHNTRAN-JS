"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ANTI_PROTECTION_KEYS,
  getAntiProtectionState,
  setAntiProtectionState
} = require("../core/runtime/antiProtection");

test("Anti protection registry includes the supported moderation set", () => {
  assert.deepEqual(ANTI_PROTECTION_KEYS, [
    "anti_nude", "anti_undo", "anti_danger_link", "anti_sticker_spam", "anti_link", "anti_spam",
    "anti_card", "anti_doodle", "anti_file", "anti_gif", "anti_join", "anti_location",
    "anti_other", "anti_photo", "anti_qr", "anti_reaction", "anti_sticker", "anti_taghide",
    "anti_video", "anti_voice", "anti_word"
  ]);
});

test("feature state reflects strict persisted booleans and defaults to off", () => {
  const source = { anti_nude:true, anti_undo:1, anti_link:false, anti_spam:true, anti_qr:true };
  const state = getAntiProtectionState(source);
  assert.equal(state.anti_nude, true);
  assert.equal(state.anti_undo, false);
  assert.equal(state.anti_link, false);
  assert.equal(state.anti_spam, true);
  assert.equal(state.anti_qr, true);
  assert.equal(state.anti_card, false);
  assert.equal(Object.keys(state).length, ANTI_PROTECTION_KEYS.length);
});

test("feature updates preserve unrelated group settings and warning history", () => {
  const data = { bot_enabled:true, disabled_commands:["menu"], anti_nude_warnings:{memberA:2} };
  const state = setAntiProtectionState(data, "anti_sticker", true);
  assert.equal(data.anti_sticker, true);
  assert.equal(data.bot_enabled, true);
  assert.deepEqual(data.disabled_commands, ["menu"]);
  assert.deepEqual(data.anti_nude_warnings, {memberA:2});
  assert.equal(state.anti_sticker, true);
});

test("unknown anti settings and non-boolean values are rejected", () => {
  const data = {};
  assert.throws(() => setAntiProtectionState(data, "anti_unknown", true), /không hợp lệ/);
  assert.throws(() => setAntiProtectionState(data, "anti_link", "on"), /boolean/);
  assert.deepEqual(data, {});
});
