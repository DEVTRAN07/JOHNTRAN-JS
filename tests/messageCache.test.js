const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ThreadType } = require("zalo-client");
const { getMessageCache, updateMessageCache } = require("../utils");

test("message cache stores deletable group message identifiers and falls back to receive time", () => {
  const cliMsgId = `message-cache-test-${Date.now()}`;
  const event = {
    threadId: "cache-test-group",
    type: ThreadType.Group,
    data: {
      msgId: "cache-test-message",
      cliMsgId,
      uidFrom: "cache-test-user",
      idTo: "cache-test-group",
      ts: 0
    }
  };

  updateMessageCache(event);
  const cached = getMessageCache()[cliMsgId];

  try {
    assert.equal(cached.msgId, event.data.msgId);
    assert.equal(cached.cliMsgId, cliMsgId);
    assert.equal(cached.uidFrom, event.data.uidFrom);
    assert.equal(cached.threadId, event.threadId);
    assert.equal(cached.type, ThreadType.Group);
    assert.ok(cached.timestamp >= Date.now() - 1000, "missing source timestamp should use receive time");
  } finally {
    delete getMessageCache()[cliMsgId];
  }
});
