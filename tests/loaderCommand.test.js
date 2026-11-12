"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const loadCommands = require("../core/loader/loaderCommand");

const quietLogger = { log() {} };

function createFixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-loader-"));
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), source, "utf8");
  }
  t.after(() => {
    for (const name of Object.keys(files)) {
      const filePath = path.join(dir, name);
      try { delete require.cache[require.resolve(filePath)]; } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function resetRuntime(commands = new Map()) {
  global.client = { commands, events: new Map(), cooldowns: new Map() };
  global.api = {};
}

test("loader reports require failures instead of overwriting them with success", async (t) => {
  const dir = createFixture(t, {
    "broken.js": 'throw new Error("fixture require failure");',
    "working.js": 'module.exports = { config: { name: "working", cooldowns: 0 }, run: async () => {} };'
  });
  resetRuntime();

  const result = await loadCommands(null, { dir, logger: quietLogger });

  assert.equal(result.status, false);
  assert.equal(result.loaded, 1);
  assert.match(result.error, /broken\.js/);
  assert.match(result.error, /fixture require failure/);
  assert.equal(global.client.commands.has("working"), true);
});

test("loader restores the previous command when replacement onLoad fails", async (t) => {
  const previous = {
    config: { name: "failing", cooldowns: 0 },
    run: async () => "previous"
  };
  const dir = createFixture(t, {
    "failing.js": 'module.exports = { config: { name: "failing", cooldowns: 0 }, run: async () => {}, onLoad: async () => { throw new Error("fixture onLoad failure"); } };'
  });
  resetRuntime(new Map([["failing", previous]]));

  const result = await loadCommands("failing", { dir, logger: quietLogger });

  assert.equal(result.status, false);
  assert.match(result.error, /fixture onLoad failure/);
  assert.equal(global.client.commands.get("failing"), previous);
});

test("loader reports success for a valid command", async (t) => {
  const dir = createFixture(t, {
    "healthy.js": 'module.exports = { config: { name: "healthy", cooldowns: 0 }, run: async () => {} };'
  });
  resetRuntime();

  const result = await loadCommands(null, { dir, logger: quietLogger });

  assert.equal(result.status, true);
  assert.equal(result.loaded, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(global.client.commands.has("healthy"), true);
});
