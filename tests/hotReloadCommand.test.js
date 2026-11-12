"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { registerCommand } = require("../core/hotReload");

function fixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-hot-reload-"));
  const file = path.join(dir, "example.js");
  fs.writeFileSync(file, source, "utf8");
  t.after(() => {
    try { delete require.cache[require.resolve(file)]; } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return file;
}

test("hot reload does not replace a working command with an invalid module", (t) => {
  const previous = {
    config: { name: "example", cooldowns: 0 },
    run: async () => "working"
  };
  global.client = { commands: new Map([["example", previous]]), events: new Map() };
  const file = fixture(t,
    'module.exports = { config: { name: "example", cooldowns: 0 } };'
  );

  assert.equal(registerCommand(file), null);
  assert.equal(global.client.commands.get("example"), previous);
});

test("hot reload registers a command with the runtime contract", (t) => {
  global.client = { commands: new Map(), events: new Map() };
  const file = fixture(t,
    'module.exports = { config: { name: "example", cooldowns: 0 }, run: async () => {} };'
  );

  assert.equal(registerCommand(file), "example");
  assert.equal(typeof global.client.commands.get("example").run, "function");
});
