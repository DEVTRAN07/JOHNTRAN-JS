"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { downloadAllAssets } = require("../scripts/download-stk-assets");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ZcAAAAASUVORK5CYII=",
  "base64"
);

function response(buffer, contentTypeLength = buffer.length) {
  return {
    ok: true,
    status: 200,
    headers: { get: name => name === "content-length" ? String(contentTypeLength) : null },
    arrayBuffer: async () => buffer
  };
}

test("STK bootstrap stores all requested frames under src asset directory and reuses them", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jt-stk-bootstrap-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const items = [
    { id: 1, file: "1_test.png" },
    { id: 2, file: "2_test.png" }
  ];
  const fetchImpl = async url => {
    calls.push(url);
    return response(PNG);
  };

  const first = await downloadAllAssets({
    directory,
    items,
    includeMenu: false,
    concurrency: 2,
    fetchImpl,
    logger: {}
  });
  assert.equal(first.total, 2);
  assert.equal(first.downloaded, 2);
  assert.equal(first.skipped, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(await fs.readFile(path.join(directory, "1_test.png")), PNG);
  assert.deepEqual(await fs.readFile(path.join(directory, "2_test.png")), PNG);

  const manifest = JSON.parse(await fs.readFile(path.join(directory, "assets-manifest.json"), "utf8"));
  assert.equal(manifest.total, 2);
  assert.equal(manifest.items.length, 2);
  assert.match(manifest.items[0].sha256, /^[a-f0-9]{64}$/);

  const second = await downloadAllAssets({
    directory,
    items,
    includeMenu: false,
    concurrency: 2,
    fetchImpl,
    logger: {}
  });
  assert.equal(second.downloaded, 0);
  assert.equal(second.skipped, 2);
  assert.equal(calls.length, 2, "complete local assets must not touch GitHub again");
});

test("STK bootstrap rejects a non-PNG payload rather than caching a broken frame", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jt-stk-bootstrap-invalid-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    downloadAllAssets({
      directory,
      items: [{ id: 1, file: "1_bad.png" }],
      includeMenu: false,
      fetchImpl: async () => response(Buffer.from("not a png")),
      logger: {}
    }),
    /không phải PNG hợp lệ/
  );
  await assert.rejects(fs.access(path.join(directory, "1_bad.png")));
});
