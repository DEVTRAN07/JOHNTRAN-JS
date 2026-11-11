"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveThreadType,
  buildReplyData,
  createEventContext
} = require("../core/runtime/eventContext");

const ThreadType = { User: 0, Group: 1 };

test("resolveThreadType keeps private thread type and normalizes group events", () => {
  assert.equal(resolveThreadType({ type: ThreadType.User }, "message", ThreadType), ThreadType.User);
  assert.equal(resolveThreadType({ type: "group_event" }, "group_event", ThreadType), ThreadType.Group);
  assert.equal(resolveThreadType({}, "message", ThreadType), ThreadType.Group);
});

test("buildReplyData safely maps the legacy message fields", () => {
  assert.deepEqual(buildReplyData({ data: {
    content: "hello", msgType: "text", propertyExt: {}, uidFrom: "u1",
    msgId: "m1", cliMsgId: "c1", ts: 123
  }}), {
    content: "hello", msgType: "text", propertyExt: {}, uidFrom: "u1",
    msgId: "m1", cliMsgId: "c1", ts: 123
  });
  assert.deepEqual(buildReplyData(null), {
    content: undefined, msgType: undefined, propertyExt: undefined,
    uidFrom: undefined, msgId: undefined, cliMsgId: undefined, ts: undefined
  });
});

test("createEventContext wraps API and exposes reply and replyData", () => {
  const wrapped = { __reply: () => "ok" };
  const context = createEventContext({
    api: {}, eventData: { type: 1, data: { content: "hi" } },
    name: "welcome", eventType: "message", ThreadType,
    wrapForEvent: (_api, _event, name, type) => {
      assert.equal(name, "welcome");
      assert.equal(type, ThreadType.Group);
      return wrapped;
    }
  });
  assert.equal(context.api, wrapped);
  assert.equal(context.reply, wrapped.__reply);
  assert.equal(context.replyData.content, "hi");
});

test("createEventContext falls back to the original API if wrapping fails", () => {
  const api = {};
  const context = createEventContext({
    api, eventData: {}, ThreadType,
    wrapForEvent() { throw new Error("wrapper failure"); }
  });
  assert.equal(context.api, api);
  assert.equal(context.reply, undefined);
});
