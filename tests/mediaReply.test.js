"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseQuote } = require("../core/mediaReply");
const stk = require("../plugins/commands/stk");

test("quote parser accepts a direct sticker WebP URL", () => {
  const url = "https://files.zdn.vn/stickers/direct.webp?token=abc";
  const parsed = parseQuote({ data: { quote: { attach: JSON.stringify({ webp: url }) } } });
  assert.equal(parsed.webpUrl, url);
  assert.equal(stk._test.getQuotedMediaUrl({ data: { quote: { attach: JSON.stringify({ webp: url }) } } }), url);
});

test("quote parser accepts a JSON WebP object string and an object form", () => {
  const url = "https://files.zdn.vn/stickers/object.webp";
  const fromJson = parseQuote({ data: { quote: { attach: JSON.stringify({ webp: JSON.stringify({ url }) }) } } });
  const fromObject = parseQuote({ data: { quote: { attach: { webp: { url } } } } });
  assert.equal(fromJson.webpUrl, url);
  assert.equal(fromObject.webpUrl, url);
});

test("quote parser ignores an invalid WebP value without losing image/video fallback", () => {
  const image = "https://files.zdn.vn/images/photo.png";
  const parsed = parseQuote({ data: { quote: { attach: JSON.stringify({ webp: "not-json-or-url", photoUrl: image }) } } });
  assert.equal(parsed.webpUrl, null);
  assert.equal(parsed.image, image);
});
