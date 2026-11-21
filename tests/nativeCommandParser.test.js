"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../native");

const cases = [
  ["ordinary text", ["hello there", "/"], { matched: false, command: "", args: [] }],
  ["prefix only", ["/ \t\n", "/"], { matched: true, command: "", args: [] }],
  ["legacy whitespace split", ["/SCL   Sơn Tùng --format=aac", "/"], { matched: true, command: "scl", args: ["Sơn", "Tùng", "--format=aac"] }],
  ["BOM and NBSP", ["/\uFEFFMENU\u00A0xin chào", "/"], { matched: true, command: "menu", args: ["xin", "chào"] }],
  ["Vietnamese lowercase", ["/ĐĂNG nhập", "/"], { matched: true, command: "đăng", args: ["nhập"] }],
  ["empty prefix", ["/menu", ""], { matched: false, command: "", args: [] }]
];

for (const [name, input, expected] of cases) {
  test("native command parser: " + name, () => {
    assert.deepEqual(native.parseCommand(...input), expected);
    assert.deepEqual(native.__test.parseCommandFallback(...input), expected);
  });
}

test("native command parser diagnostics report load state", () => {
  const diagnostics = native.getCommandParserDiagnostics();
  assert.equal(typeof diagnostics.loaded, "boolean");
  assert.equal(typeof diagnostics.enabled, "boolean");
  assert.equal(typeof diagnostics.active, "boolean");
  assert.equal(native.nativeAvailable.commandParser, diagnostics.loaded);
});
