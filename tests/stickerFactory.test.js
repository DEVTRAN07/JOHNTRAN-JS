"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveUploadHost,
  buildStickerUrl,
  stripStickerSuffix,
  jxlToJpg
} = require("../core/stickerFactory");

test("sticker upload uses the file service supplied by the active login", () => {
  assert.equal(
    resolveUploadHost({
      loginInfo: {
        zpw_service_map_v3: { file: ["https://files-cdn.zalo.example/path/"] }
      }
    }),
    "https://files-cdn.zalo.example"
  );
});

test("sticker upload falls back when the login service map is absent or invalid", () => {
  assert.equal(resolveUploadHost({}), "https://tt-files-wpa.chat.zalo.me");
  assert.equal(
    resolveUploadHost({ loginInfo: { zpw_service_map_v3: { file: ["http://not-secure.example"] } } }),
    "https://tt-files-wpa.chat.zalo.me"
  );
  assert.equal(
    resolveUploadHost({ loginInfo: { zpw_service_map_v3: { file: ["not-a-url"] } } }),
    "https://tt-files-wpa.chat.zalo.me"
  );
});

test("sticker URLs remove stale suffixes and normalize JXL image URLs", () => {
  assert.equal(stripStickerSuffix("https://cdn.example/a.webp?sticker.webp"), "https://cdn.example/a.webp");
  assert.equal(jxlToJpg("https://cdn.example/a.jxl?x=1"), "https://cdn.example/a.jpg?x=1");
  assert.equal(buildStickerUrl("https://cdn.example/a.gif", false), "https://cdn.example/a.gif?sticker.webp");
});
