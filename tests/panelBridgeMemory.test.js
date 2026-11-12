"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { record, getMessages } = require("../core/panelBridge");

test("panel chat memory keeps the 30 most recently active conversations", () => {
  const prefix = `panel-memory-${process.pid}-${Date.now()}-`;
  for (let index = 0; index < 30; index++) {
    record(`${prefix}${index}`, { text: `message-${index}` });
  }

  // Touch the oldest conversation so it becomes the most recently active.
  record(`${prefix}0`, { text: "message-0-latest" });
  record(`${prefix}30`, { text: "message-30" });

  assert.equal(getMessages(`${prefix}0`, 100).length, 2);
  assert.deepEqual(getMessages(`${prefix}1`, 100), []);
  assert.equal(getMessages(`${prefix}2`, 100).length, 1);
  assert.equal(getMessages(`${prefix}30`, 100).length, 1);
});

test("panel chat memory keeps only the latest 200 messages per conversation", () => {
  const threadId = `panel-message-limit-${process.pid}-${Date.now()}`;
  for (let index = 0; index < 205; index++) {
    record(threadId, { text: `message-${index}` });
  }

  const messages = getMessages(threadId, 1000);
  assert.equal(messages.length, 200);
  assert.equal(messages[0].text, "message-5");
  assert.equal(messages[messages.length - 1].text, "message-204");
});
