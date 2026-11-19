"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INTENTIONAL_RECALL_TTL_MS,
  rememberIntentionalRecall,
  isIntentionalRecall,
  recallIntentionally,
  _test
} = require("../core/runtime/intentionalRecall");

test.afterEach(() => _test.clear());

test("intentional recall is matched by group and original cliMsgId only", () => {
  rememberIntentionalRecall("group-a", { cliMsgId: "message-1", msgId: "msg-1" }, "caro", 1000);
  assert.equal(isIntentionalRecall({
    threadId: "group-a",
    data: { content: { cliMsgId: "message-1" } }
  }, 1001), true);
  assert.equal(isIntentionalRecall({
    threadId: "group-b",
    data: { content: { cliMsgId: "message-1" } }
  }, 1001), false);
  assert.equal(isIntentionalRecall({
    threadId: "group-a",
    data: { content: { cliMsgId: "another-message" } }
  }, 1001), false);
});

test("intentional recall markers expire after the bounded safety window", () => {
  rememberIntentionalRecall("group-a", { cliMsgId: "message-2" }, "tlmn", 5000);
  assert.equal(isIntentionalRecall({
    threadId: "group-a",
    data: { content: { cliMsgId: "message-2" } }
  }, 5000 + INTENTIONAL_RECALL_TTL_MS - 1), true);
  assert.equal(isIntentionalRecall({
    threadId: "group-a",
    data: { content: { cliMsgId: "message-2" } }
  }, 5000 + INTENTIONAL_RECALL_TTL_MS), false);
});

test("recallIntentionally calls Zalo once and keeps a suppression marker for the callback", async () => {
  const calls = [];
  const api = {
    async undo(message, threadId, type) {
      calls.push({ message, threadId, type });
      return { success: true };
    }
  };
  await recallIntentionally(api, { msgId: "msg-3", cliMsgId: "cli-3" }, "group-c", 1, "noitu");
  assert.deepEqual(calls, [{
    message: { msgId: "msg-3", cliMsgId: "cli-3" },
    threadId: "group-c",
    type: 1
  }]);
  assert.equal(isIntentionalRecall({
    threadId: "group-c",
    data: { content: { cliMsgId: "cli-3" } }
  }), true);
});
