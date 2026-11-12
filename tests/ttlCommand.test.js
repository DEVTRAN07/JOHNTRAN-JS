"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/ttl");

test("ttl accepts bot-only recall durations", () => {
  assert.deepEqual(command._test.parse("30s"), { mode: "local", ms: 30000, label: "30s" });
  assert.equal(command._test.parse("5m").ms, 300000);
  assert.equal(command._test.parse("1h").ms, 3600000);
  assert.equal(command._test.parse("1d").ms, 86400000);
});
test("ttl rejects invalid and unsafe durations", () => {
  for (const value of ["1s", "4s", "31d", "999999d", "abc", "30m?"]) assert.ok(command._test.parse(value).error);
});
test("ttl supports disabling and restoring defaults", () => {
  assert.equal(command._test.parse("off").mode, "off");
  assert.equal(command._test.parse("default").mode, "default");
});
