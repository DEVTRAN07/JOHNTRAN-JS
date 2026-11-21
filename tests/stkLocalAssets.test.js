"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const service = require("../core/stkDiscordService");

const PNG_HEADER = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
  73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1
]);

test("STK reads a valid local frame without issuing any network request", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jt-stk-local-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const frame = service.getDecoration(12);
  const filePath = path.join(directory, frame.file);
  await fs.writeFile(filePath, PNG_HEADER);

  const resolved = await service.ensureDecorationFile(12, {
    directory,
    fetchImpl: async () => {
      throw new Error("network must not be called for a local frame");
    }
  });
  assert.equal(resolved, filePath);
});

test("STK local frame directory is pinned to src/assets/stk", () => {
  assert.match(service.DECOR_DIR.replace(/\\/g, "/"), /\/src\/assets\/stk$/);
  assert.equal(service.DEFAULT_CACHE_TTL_MS, Number.MAX_SAFE_INTEGER);
});
