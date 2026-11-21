"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRemote, isTargetRemote, parseAheadBehind, hasDependencyChanges, parsePorcelainPath, validateLocalChanges } = require("../scripts/update");

test("normalizeRemote accepts HTTPS and SSH GitHub remotes", () => {
  assert.equal(normalizeRemote("https://github.com/DEVTRAN07/JOHNTRAN-JS.git"), "https://github.com/DEVTRAN07/JOHNTRAN-JS");
  assert.equal(normalizeRemote("git@github.com:DEVTRAN07/JOHNTRAN-JS.git"), "https://github.com/DEVTRAN07/JOHNTRAN-JS");
  assert.equal(normalizeRemote("ssh://git@github.com/DEVTRAN07/JOHNTRAN-JS.git"), "https://github.com/DEVTRAN07/JOHNTRAN-JS");
});

test("isTargetRemote rejects unrelated remotes", () => {
  assert.equal(isTargetRemote("https://github.com/DEVTRAN07/JOHNTRAN-JS.git"), true);
  assert.equal(isTargetRemote("https://github.com/someone/other-bot.git"), false);
  assert.equal(isTargetRemote("https://example.com/DEVTRAN07/JOHNTRAN-JS.git"), false);
  assert.equal(isTargetRemote("http://github.com/DEVTRAN07/JOHNTRAN-JS.git"), false);
});

test("parseAheadBehind reads git rev-list counts", () => {
  assert.deepEqual(parseAheadBehind("0\t5\n"), { ahead: 0, behind: 5 });
  assert.deepEqual(parseAheadBehind("2 0"), { ahead: 2, behind: 0 });
  assert.throws(() => parseAheadBehind("unknown"));
});

test("dependency changes are detected only for package manifests", () => {
  assert.equal(hasDependencyChanges(["core/listen.js"]), false);
  assert.equal(hasDependencyChanges(["package-lock.json"]), true);
  assert.equal(hasDependencyChanges(["package.json"]), true);
  assert.equal(hasDependencyChanges(["README.md"]), false);
});


test("local config.yml changes are recognized and can be preserved without permitting code edits", () => {
  assert.equal(parsePorcelainPath(" M config.yml"), "config.yml");
  assert.equal(parsePorcelainPath("R  old.yml -> config.yml"), "config.yml");

  const clean = validateLocalChanges("");
  assert.equal(clean.hasConfigOverride, false);

  const configOnly = validateLocalChanges(" M config.yml");
  assert.equal(configOnly.hasConfigOverride, true);
  assert.deepEqual(configOnly.paths, ["config.yml"]);

  assert.throws(
    () => validateLocalChanges(" M config.yml\n M core/listen.js"),
    /ngoài config\.yml/
  );
});
