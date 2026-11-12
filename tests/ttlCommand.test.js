"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/ttl");

test("ttl accepts 30 seconds for bot messages", () => {
  assert.deepEqual(command._test.parse("30s"), { mode: "local", ms: 30000, label: "30 giây" });
});
test("ttl keeps native Zalo chat expiry in whole days", () => {
  assert.equal(command._test.parse("5d").mode, "native");
  assert.equal(command._test.parse("5d").ms, 5 * command._test.DAY_MS);
});
test("ttl rejects unsupported sub-day native values and unsafe local values", () => {
  for (const value of ["1s", "2s", "30m", "2h", "31d", "abc"]) assert.ok(command._test.parse(value).error);
});
test("ttl off is recognized", () => assert.equal(command._test.parse("off").mode, "off"));
