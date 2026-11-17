"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const command = require("../plugins/commands/tiktok");
const { mediaCache } = require("../core/mediaCache");

test("TikTok builds local attachment paths accepted by the Zalo SDK", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-tiktok-attachments-"));
  const videoBuffer = Buffer.concat([Buffer.from("ftyp"), Buffer.alloc(32, 1)]);
  const audioBuffer = Buffer.from("ID3mock-audio-data");
  try {
    const attachments = command._test.buildSendableAttachments(
      tempDir,
      { buffer: videoBuffer },
      { buffer: audioBuffer },
      "https://cdn.example/audio.m4a?token=secret"
    );
    assert.equal(attachments.length, 2);
    assert.ok(attachments.every(file => path.isAbsolute(file)));
    assert.deepEqual(fs.readFileSync(attachments[0]), videoBuffer);
    assert.deepEqual(fs.readFileSync(attachments[1]), audioBuffer);
    assert.match(attachments[0], /video\.mp4$/);
    assert.match(attachments[1], /audio\.m4a$/);
    assert.ok(attachments.every(file => !file.startsWith("file://")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TikTok URL cache index reuses the media cache content key", async () => {
  const url = "https://cdn.example/tiktok-video.mp4?sig=unique-test";
  const buffer = Buffer.from("cached-video-payload");
  const originalUpload = mediaCache.upload;
  const originalGet = mediaCache.get;
  command._test.sourceIndex.clear();

  try {
    mediaCache.upload = async (_buffer, _type, _metadata) => ({
      key: "media-content-key",
      url: "file:///not-for-zalo-upload",
      cached: false
    });
    mediaCache.get = async key => key === "media-content-key" ? { buffer } : null;

    const stored = await command._test.storeMedia(url, buffer, "video", { title: "test" });
    assert.equal(stored.key, "media-content-key");
    assert.equal(command._test.sourceIndex.get(command._test.urlCacheKey(url)).cacheKey, "media-content-key");

    const hit = await command._test.cachedMedia(url, "video");
    assert.equal(hit.cached, true);
    assert.deepEqual(hit.buffer, buffer);
  } finally {
    mediaCache.upload = originalUpload;
    mediaCache.get = originalGet;
    command._test.sourceIndex.clear();
  }
});

test("TikTok cache index is bounded", () => {
  const index = command._test.sourceIndex;
  index.clear();
  for (let i = 0; i < command._test.SOURCE_INDEX_MAX + 20; i++) {
    command._test.rememberSource("https://cdn.example/" + i, "video", "key-" + i);
  }
  assert.equal(index.size, command._test.SOURCE_INDEX_MAX);
  index.clear();
});
