"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPlainText, safePrimitiveString } = require("../core/runtime/plainText");

test("safePrimitiveString accepts only safe primitive identifiers", () => {
  assert.equal(safePrimitiveString(" user-1 "), "user-1");
  assert.equal(safePrimitiveString(42), "42");
  assert.equal(safePrimitiveString(42n), "42");
  assert.equal(safePrimitiveString(true), "true");
  assert.equal(safePrimitiveString(null), "");
  assert.equal(safePrimitiveString(undefined), "");
  assert.equal(safePrimitiveString({ id: "user-1" }), "");
  assert.equal(safePrimitiveString(Object.create(null)), "");
});

test("safePrimitiveString never calls user-defined primitive conversion hooks", () => {
  let calls = 0;
  const input = {
    [Symbol.toPrimitive]() {
      calls++;
      throw new Error("must not be called");
    },
    toString() {
      calls++;
      throw new Error("must not be called");
    }
  };

  assert.equal(safePrimitiveString(input), "");
  assert.equal(calls, 0);
});

test("extractPlainText remains safe for null-prototype and accessor-backed SDK payloads", () => {
  assert.equal(extractPlainText(Object.create(null)), "");
  const payload = Object.create(null);
  Object.defineProperty(payload, "title", {
    get() { throw new Error("SDK getter unavailable"); }
  });
  payload.text = " hello ";
  assert.equal(extractPlainText(payload), "hello");
});
