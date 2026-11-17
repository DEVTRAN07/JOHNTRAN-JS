"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ANTI_PROTECTION_KEYS,
  getAntiProtectionState,
  setAntiProtectionState
} = require("../core/runtime/antiProtection");

test("panel exposes only the six anti modes already supported by the bot", () => {
  assert.deepEqual(ANTI_PROTECTION_KEYS, [
    "anti_nude", "anti_undo", "anti_danger_link",
    "anti_sticker_spam", "anti_link", "anti_spam"
  ]);
});

test("feature state reflects strict persisted booleans and defaults to off", () => {
  assert.deepEqual(getAntiProtectionState({
    anti_nude: true,
    anti_undo: 1,
    anti_link: false,
    anti_spam: true
  }), {
    anti_nude: true,
    anti_undo: false,
    anti_danger_link: false,
    anti_sticker_spam: false,
    anti_link: false,
    anti_spam: true
  });
});

test("feature updates persist in the same group data object", () => {
  const data = { bot_enabled: true, disabled_commands: ["menu"] };
  const state = setAntiProtectionState(data, "anti_sticker_spam", true);
  assert.equal(data.anti_sticker_spam, true);
  assert.equal(data.bot_enabled, true);
  assert.deepEqual(data.disabled_commands, ["menu"]);
  assert.equal(state.anti_sticker_spam, true);
});

test("unknown anti settings and non-boolean values are rejected", () => {
  const data = {};
  assert.throws(() => setAntiProtectionState(data, "anti_qr", true), /không hợp lệ/);
  assert.throws(() => setAntiProtectionState(data, "anti_link", "on"), /boolean/);
  assert.deepEqual(data, {});
});
