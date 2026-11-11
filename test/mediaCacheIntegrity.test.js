const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MediaCache } = require("../core/mediaCache");

const R2_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
];

function withoutR2() {
  const previous = Object.fromEntries(R2_ENV.map((key) => [key, process.env[key]]));
  for (const key of R2_ENV) delete process.env[key];
  return () => {
    for (const key of R2_ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test("local media cache rejects same-size tampering and can rebuild the entry", async () => {
  const restoreEnv = withoutR2();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-cache-"));
  try {
    const cache = new MediaCache({ cacheDir, ttl: { image: 60_000 } });
    const original = Buffer.from("valid media payload");
    const metadata = { contentType: "application/octet-stream", source: "test" };
    const uploaded = await cache.upload(original, "image", metadata);
    const blobPath = path.join(cacheDir, "image", uploaded.key);

    const valid = await cache.get(uploaded.key);
    assert.equal(valid.buffer.toString(), original.toString());

    // Giữ nguyên kích thước để kiểm tra checksum, không chỉ metadata.size.
    fs.writeFileSync(blobPath, Buffer.from("xxxxx media payload"));
    const rejected = await cache.get(uploaded.key);
    assert.equal(rejected, null);
    assert.equal(fs.existsSync(blobPath), false);

    const rebuilt = await cache.upload(original, "image", metadata);
    assert.equal(rebuilt.key, uploaded.key);
    const restored = await cache.get(uploaded.key);
    assert.equal(restored.buffer.toString(), original.toString());
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("local media cache removes expired entries", async () => {
  const restoreEnv = withoutR2();
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-cache-expired-"));
  try {
    const cache = new MediaCache({ cacheDir, ttl: { image: 60_000 } });
    const uploaded = await cache.upload(Buffer.from("payload"), "image", {});
    const metaPath = path.join(cacheDir, "image", uploaded.key + ".meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.expiresAt = Date.now() - 1000;
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    assert.equal(await cache.get(uploaded.key), null);
    assert.equal(fs.existsSync(path.join(cacheDir, "image", uploaded.key)), false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    restoreEnv();
  }
});

test("MEDIA_CACHE_TTL_* environment values are interpreted as seconds", () => {
  const restoreEnv = withoutR2();
  const previous = process.env.MEDIA_CACHE_TTL_IMAGE;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-cache-ttl-"));
  try {
    process.env.MEDIA_CACHE_TTL_IMAGE = "2";
    const cache = new MediaCache({ cacheDir });
    assert.equal(cache.stats().ttls.image, 2000);
  } finally {
    if (previous === undefined) delete process.env.MEDIA_CACHE_TTL_IMAGE;
    else process.env.MEDIA_CACHE_TTL_IMAGE = previous;
    fs.rmSync(cacheDir, { recursive: true, force: true });
    restoreEnv();
  }
});
