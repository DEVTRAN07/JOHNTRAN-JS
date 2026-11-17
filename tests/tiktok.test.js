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


const normalizedVideo = require("../core/tiktok").normalizeVideoData({
  title: "A TikTok",
  author: { nickname: "Creator" },
  duration: 12,
  hdplay: "https://cdn.example/video.mp4",
  music: "https://cdn.example/audio.mp3?token=1",
  cover: "https://cdn.example/cover.jpg"
});
assert.strictEqual(normalizedVideo.videoUrl, "https://cdn.example/video.mp4");
assert.strictEqual(normalizedVideo.musicUrl, "https://cdn.example/audio.mp3?token=1");
assert.strictEqual(normalizedVideo.author, "Creator");

const musicOnly = require("../core/tiktok").normalizeVideoData({
  music: "https://cdn.example/audio.m4a"
});
assert.strictEqual(musicOnly.videoUrl, "");
assert.strictEqual(musicOnly.musicUrl, "https://cdn.example/audio.m4a");
assert.throws(() => require("../core/tiktok").normalizeVideoData({}), /không trả về link video hoặc âm thanh/i);
