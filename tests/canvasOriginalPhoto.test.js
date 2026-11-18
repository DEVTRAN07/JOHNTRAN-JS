"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  _test: { isCanvasImageAttachment, photoQualityMetadata }
} = require("../vendor/zalo-client/dist/cjs/api/sendMessage.cjs");

test("Canvas render PNGs are recognized for Original delivery", () => {
  assert.equal(isCanvasImageAttachment("/tmp/jt_menu_1795000000000_a1b2.png"), true);
  assert.equal(isCanvasImageAttachment("C:\\tmp\\jt_profile_card_1795000000000_z9x8.png"), true);
  assert.equal(isCanvasImageAttachment("/tmp/avatar.png"), false);
  assert.equal(isCanvasImageAttachment("/tmp/jt_menu_1795000000000_a1b2.jpg"), false);
  assert.equal(isCanvasImageAttachment("/tmp/jt_sticker_1795000000000_a1b2.gif"), false);
  assert.equal(isCanvasImageAttachment({ filename: "jt_anti-protection-v2_1795000000000_a1b2.png" }), true);
});

test("Canvas images receive Original metadata without JXL conversion", () => {
  assert.deepEqual(photoQualityMetadata(true), {
    is_original: 1,
    jcp: JSON.stringify({ is_original: 1, isOriginal: 1 })
  });
});

test("ordinary image sends retain the previous JXL metadata", () => {
  assert.deepEqual(photoQualityMetadata(false), { jcp: '{"convertible":"jxl"}' });
});
