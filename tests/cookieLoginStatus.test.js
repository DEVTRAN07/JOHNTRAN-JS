"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const login = require("../core/login");

test("successful Cookie + IMEI login marks runtime and BotStats as logged_in", () => {
  const previousState = login.getLoginState();
  let saved = null;
  const api = { authenticated: true };

  try {
    const result = login.markLoginSuccess(api, (state, extra) => {
      saved = { state, extra };
    });

    assert.equal(result, api);
    assert.equal(login.getLoginState(), "logged_in");
    assert.equal(saved.state, "logged_in");
    assert.equal(saved.extra.loginMethod, "cookie_imei");
    assert.match(saved.extra.loginMessage, /Cookie \+ IMEI/);
  } finally {
    login.setLoginState(previousState);
  }
});


test("Zalo API request policy defaults to fast failure instead of multi-minute retries", () => {
  const policy = login.resolveZaloRetryPolicy({}, { timeoutMs: 60000, limit: 3 });
  assert.equal(policy.timeoutMs, 15000);
  assert.equal(policy.retries, 1);
  assert.deepEqual(policy.methods, ["GET", "HEAD"]);
});

test("Zalo API request policy honours bounded environment overrides", () => {
  const policy = login.resolveZaloRetryPolicy({
    JT_ZALO_API_TIMEOUT_MS: "4500",
    JT_ZALO_API_RETRIES: "0",
    JT_ZALO_API_RETRY_DELAY_MS: "100"
  }, { timeoutMs: 12000, limit: 1 });

  assert.equal(policy.timeoutMs, 4500);
  assert.equal(policy.retries, 0);
  assert.equal(policy.delayMs, 100);
});
