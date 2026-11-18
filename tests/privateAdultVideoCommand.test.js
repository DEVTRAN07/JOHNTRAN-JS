"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const handleCommand = require("../core/handle/handleCommand");

test("private-command exception allows only the explicit /vd 18+ invocation", () => {
  const allowed = handleCommand._isPrivateAdultVideoInvocation;
  assert.equal(allowed("/vd 18+", "/", ThreadType.User, ThreadType), true);
  assert.equal(allowed("/getvd 18+ romance", "/", ThreadType.User, ThreadType), true);
  assert.equal(allowed("/getvideo 18+", "/", ThreadType.User, ThreadType), true);
  assert.equal(allowed("/vd", "/", ThreadType.User, ThreadType), false);
  assert.equal(allowed("/status 18+", "/", ThreadType.User, ThreadType), false);
  assert.equal(allowed("/vd 18+", "/", ThreadType.Group, ThreadType), false);
  assert.equal(allowed("vd 18+", "/", ThreadType.User, ThreadType), false);
});
