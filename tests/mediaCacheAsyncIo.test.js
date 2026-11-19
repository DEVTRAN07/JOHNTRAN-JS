"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MediaCache } = require("../core/mediaCache");

function withoutR2() {
  const keys = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test("media cache uses async filesystem operations and keeps local hit URLs indexed", async () => {
  const restoreEnv = withoutR2();
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "johntran-media-async-"));
  try {
    const cache = new MediaCache({ cacheDir });
    const payload = Buffer.from("binary-media-payload");
    const uploaded = await cache.upload(payload, "audio", { contentType: "audio/mpeg" });

    assert.equal(uploaded.cached, false);
    assert.match(uploaded.url, /audio/);
    assert.equal(cache.stats().localFiles, 1);

    const loaded = await cache.get(uploaded.key);
    assert.equal(loaded.buffer.toString(), payload.toString());

    const cached = await cache.upload(payload, "audio", { contentType: "audio/mpeg" });
    assert.equal(cached.cached, true);
    assert.equal(cached.url, uploaded.url);
    assert.equal(cache.stats().localFiles, 1);

    assert.equal(await cache.invalidate(uploaded.key), true);
    assert.equal(await cache.get(uploaded.key), null);
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("media cache initialization and disk reads yield to the event loop", async () => {
  const restoreEnv = withoutR2();
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "johntran-media-yield-"));
  try {
    const cache = new MediaCache({ cacheDir });
    const payload = Buffer.alloc(2 * 1024 * 1024, 7);
    const uploaded = await cache.upload(payload, "video", { contentType: "video/mp4" });

    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 0);
    try {
      const result = await cache.get(uploaded.key);
      assert.equal(result.buffer.length, payload.length);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(timerFired, true, "a timer should run during async cache disk reads");
  } finally {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
    restoreEnv();
  }
});
