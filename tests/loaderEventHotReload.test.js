"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loadEvents = require("../core/loader/loaderEvent");

test("loadEvents reloads changed source and preserves the previous module when onLoad fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-events-"));
  const file = path.join(dir, "sample.js");
  const previousClient = global.client;
  const previousApi = global.api;
  global.client = { events: new Map() };
  global.api = {};

  const writeEvent = (marker, shouldFail = false) => {
    fs.writeFileSync(file, `module.exports = {
      config: { name: "sample", event_type: ["message"] },
      marker: ${JSON.stringify(marker)},
      run() {},
      onLoad: ${shouldFail ? 'async () => { throw new Error("init failed"); }' : 'async () => {}'}
    };`);
  };

  try {
    writeEvent("v1");
    await loadEvents(dir);
    assert.equal(global.client.events.get("sample").marker, "v1");

    // Same path, new source: loader must evict the old CommonJS module.
    writeEvent("v2");
    await loadEvents(dir);
    assert.equal(global.client.events.get("sample").marker, "v2");

    // Failed initialization must not replace the last known-good module.
    const stableModule = global.client.events.get("sample");
    writeEvent("broken", true);
    await loadEvents(dir);
    assert.equal(global.client.events.get("sample"), stableModule);
    assert.equal(global.client.events.get("sample").marker, "v2");
  } finally {
    try { delete require.cache[require.resolve(file)]; } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    global.client = previousClient;
    global.api = previousApi;
  }
});
