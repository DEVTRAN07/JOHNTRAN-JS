const assert = require("assert");
const { isTikTokUrl } = require("../core/tiktok");

// ===== isTikTokUrl =====
assert.strictEqual(typeof isTikTokUrl, "function");
assert.strictEqual(isTikTokUrl("https://www.tiktok.com/@user/video/123"), true);
assert.strictEqual(isTikTokUrl("https://vt.tiktok.com/abc"), true);
assert.strictEqual(isTikTokUrl("https://vm.tiktok.com/abc"), true);
assert.strictEqual(isTikTokUrl("https://www.douyin.com/video/123"), true);
assert.strictEqual(isTikTokUrl("https://www.youtube.com/watch?v=123"), false);
assert.strictEqual(isTikTokUrl("https://www.facebook.com/reel/123"), false);
assert.strictEqual(isTikTokUrl("not a url"), false);
assert.strictEqual(isTikTokUrl(null), false);
assert.strictEqual(isTikTokUrl(""), false);

console.log("✓ tiktok tests passed");
