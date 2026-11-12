const assert = require("assert");
const {
  ytDlpAvailable,
  supportsImpersonate,
  getMediaInfo,
  downloadVideo,
  downloadAudio,
  isAudioOnly,
  describe
} = require("../core/mediaDownloader");

// ===== sanity: exports are functions =====
assert.strictEqual(typeof ytDlpAvailable, "function");
assert.strictEqual(typeof supportsImpersonate, "function");
assert.strictEqual(typeof getMediaInfo, "function");
assert.strictEqual(typeof downloadVideo, "function");
assert.strictEqual(typeof downloadAudio, "function");
assert.strictEqual(typeof isAudioOnly, "function");
assert.strictEqual(typeof describe, "function");

// ===== isAudioOnly (matches core/mediaDownloader.js:200) =====
assert.strictEqual(isAudioOnly(null), true);                 // !info → true
assert.strictEqual(isAudioOnly(undefined), true);            // !info → true
assert.strictEqual(isAudioOnly({ vcodec: "none" }), true);   // vcodec === "none"
assert.strictEqual(isAudioOnly({ vcodec: "avc1" }), false);  // vcodec !== "none"
assert.strictEqual(isAudioOnly({ formats: [] }), false);     // formats rỗng → vcodec === "none" (undefined)
assert.strictEqual(
  isAudioOnly({ formats: [{ vcodec: "none" }, { vcodec: "none" }] }),
  true
);
assert.strictEqual(
  isAudioOnly({ formats: [{ vcodec: "avc1" }] }),
  false
);
assert.strictEqual(
  isAudioOnly({ formats: [{ vcodec: "none" }, { vcodec: "avc1" }] }),
  false
);

// ===== describe (matches core/mediaDownloader.js:281) =====
const desc = describe({
  title: "TikTok video",
  uploader: "user123",
  duration: 125
});
assert.ok(desc.some((d) => d.includes("Title: TikTok video")));
assert.ok(desc.some((d) => d.includes("Author: user123")));
assert.ok(desc.some((d) => d.includes("Thời lượng: 2:05")));

// describe dùng channel thay vì uploader
const desc2 = describe({ title: "X", channel: "chanX", duration: 5 });
assert.ok(desc2.some((d) => d.includes("Author: chanX")));
assert.ok(desc2.some((d) => d.includes("Thời lượng: 0:05")));

// describe không push field nào khi thiếu dữ liệu
assert.deepStrictEqual(describe({}), []);

console.log("✓ mediaDownloader tests passed");
