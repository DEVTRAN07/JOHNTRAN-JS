const assert = require("node:assert/strict");
const test = require("node:test");
const {
  timingSafeStringEqual,
  isLoopbackHost,
  assertPanelToken,
  isPanelRequestAuthorized,
} = require("../utils/tokenSecurity");

test("compares tokens safely and rejects missing or different values", () => {
  assert.equal(timingSafeStringEqual("a".repeat(64), "a".repeat(64)), true);
  assert.equal(timingSafeStringEqual("a".repeat(64), "b".repeat(64)), false);
  assert.equal(timingSafeStringEqual("short", "shorter"), false);
  assert.equal(timingSafeStringEqual("", ""), false);
  assert.equal(timingSafeStringEqual("secret", null), false);
});

test("recognizes only loopback bind addresses as local", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.1.10"), false);
});

test("requires a strong token for a public Panel bind", () => {
  assert.equal(assertPanelToken("", "127.0.0.1"), true);
  assert.equal(assertPanelToken("local-token", "localhost"), true);
  assert.throws(() => assertPanelToken("", "0.0.0.0"), /JT_PANEL__TOKEN/);
  assert.throws(() => assertPanelToken("too-short", "0.0.0.0"), /32 ký tự/);
  assert.equal(assertPanelToken("x".repeat(64), "0.0.0.0"), true);
});

test("accepts Bearer header and rejects query-string-only credentials", () => {
  const token = "t".repeat(64);
  const req = (authorization) => ({ headers: authorization ? { authorization } : {} });
  assert.equal(isPanelRequestAuthorized(req("Bearer " + token), token, "0.0.0.0"), true);
  assert.equal(isPanelRequestAuthorized(req("Bearer wrong"), token, "0.0.0.0"), false);
  assert.equal(isPanelRequestAuthorized(req(null), token, "0.0.0.0"), false);
  assert.equal(isPanelRequestAuthorized(req(null), "", "127.0.0.1"), true);
  assert.equal(isPanelRequestAuthorized(req(null), "", "0.0.0.0"), false);
});
