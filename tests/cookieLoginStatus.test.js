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
