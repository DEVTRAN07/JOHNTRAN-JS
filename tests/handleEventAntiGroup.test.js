"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const handleEvent = require("../core/handle/handleEvent");

test("group undo payload without type is still guarded as a group event", () => {
  assert.equal(handleEvent._test.isGroupEventPayload("undo", {
    threadId:"group", isGroup:true, data:{}
  }), true);
  assert.equal(handleEvent._test.isGroupEventPayload("undo", {
    threadId:"private", isGroup:false, data:{}
  }), false);
  assert.equal(handleEvent._test.isGroupEventPayload("message", {
    threadId:"group", type:ThreadType.Group, data:{}
  }), true);
});
