"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isSafePackageSpec } = require("../core/loader/pluginDeps");

test("plugin dependency specs accept normal npm names and semver ranges", () => {
  assert.equal(isSafePackageSpec("canvas", "^3.1.2"), true);
  assert.equal(isSafePackageSpec("@napi-rs/canvas", "^2"), true);
  assert.equal(isSafePackageSpec("some-package", "latest"), true);
  assert.equal(isSafePackageSpec("some_package", "~1.2.3"), true);
});

test("plugin dependency specs reject shell syntax and malformed package names", () => {
  assert.equal(isSafePackageSpec("pkg;touch /tmp/pwned", "latest"), false);
  assert.equal(isSafePackageSpec("pkg", "1.0.0 && echo hacked"), false);
  assert.equal(isSafePackageSpec("$(whoami)", "latest"), false);
  assert.equal(isSafePackageSpec("../outside", "latest"), false);
  assert.equal(isSafePackageSpec("", "latest"), false);
});
