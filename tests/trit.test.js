"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TRIT, isTrit, fromBoolean, isTrue } = require("../core/runtime/trit");
const { resolveGroupAdminState } = require("../core/runtime/middleware/permissions");

test("one trit has exactly unknown, false and true values", () => {
  assert.deepEqual(TRIT, { UNKNOWN: -1, FALSE: 0, TRUE: 1 });
  assert.equal(isTrit(-1), true);
  assert.equal(isTrit(0), true);
  assert.equal(isTrit(1), true);
  assert.equal(isTrit(2), false);
  assert.equal(fromBoolean(false), -1 + 1);
  assert.equal(fromBoolean(true), 1);
  assert.equal(isTrue(-1), false);
  assert.equal(isTrue(0), false);
  assert.equal(isTrue(1), true);
});

test("group-admin authorization maps API result to -1, 0 or 1", () => {
  assert.equal(resolveGroupAdminState(null, "u1"), TRIT.UNKNOWN);
  assert.equal(resolveGroupAdminState({}, "u1"), TRIT.FALSE);
  assert.equal(resolveGroupAdminState({ creatorId: "u1" }, "u1"), TRIT.TRUE);
  assert.equal(resolveGroupAdminState({ adminIds: ["u1"] }, "u1"), TRIT.TRUE);
});
