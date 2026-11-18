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


test("panel chat preview caps long message text before it enters the persisted ring", () => {
  const { MAX_PANEL_MESSAGE_TEXT_LENGTH } = require("../core/panelBridge");
  const threadId = "panel-long-message-" + process.pid + "-" + Date.now();
  record(threadId, { text: "x".repeat(MAX_PANEL_MESSAGE_TEXT_LENGTH * 20) });
  const [message] = getMessages(threadId, 1);
  assert.equal(message.text.length, MAX_PANEL_MESSAGE_TEXT_LENGTH);
  assert.ok(message.text.endsWith("…"));
});


test("panel ring persistence serializes one conversation at a time and yields between chunks", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { _test } = require("../core/panelBridge");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-panel-chunks-"));
  const target = path.join(directory, "panel_chat.json");
  const entries = Array.from({ length: 5 }, (_, groupIndex) => [
    "group-" + groupIndex,
    Array.from({ length: 200 }, (_, messageIndex) => ({
      ts: groupIndex * 1000 + messageIndex,
      from: "member-" + messageIndex,
      name: "Member " + messageIndex,
      text: ("Tin nhắn nhóm " + groupIndex + " nội dung có dấu tiếng Việt 😀 ").repeat(10),
      isSelf: false
    }))
  ]);
  let yieldCount = 0;

  try {
    assert.equal(await _test.persistEntriesInChunks(entries, target, {
      yieldEvery: 1,
      onYield() { yieldCount++; }
    }), true);
    const saved = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.deepEqual(saved, Object.fromEntries(entries));
    assert.equal(yieldCount, entries.length - 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
