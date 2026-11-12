"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const {
  HISTORY_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
  maxHistoryPages,
  vietnamDayStartMs,
  inspectGroupHistoryPage
} = require("../core/topchat/wsBackfill");

function groupMessage(msgId, timestamp) {
  return {
    type: ThreadType.Group,
    threadId: "group",
    isSelf: false,
    data: {
      msgId,
      uidFrom: "user",
      ts: String(timestamp),
      content: "message",
      msgType: "text"
    }
  };
}

test("WebSocket backfill uses 50-message pages and a bounded configurable page cap", () => {
  assert.equal(HISTORY_PAGE_SIZE, 50);
  assert.equal(maxHistoryPages("180"), 180);
  assert.equal(maxHistoryPages("9999"), 500);
  assert.equal(maxHistoryPages("0"), 1);
  assert.equal(maxHistoryPages("not-a-number"), DEFAULT_MAX_PAGES);
});

test("WebSocket backfill requests the previous page using the oldest message id", () => {
  const date = "2026-11-12";
  const now = Date.parse("2026-11-12T12:00:00+07:00");
  const messages = Array.from({ length: 50 }, (_, index) =>
    groupMessage("cursor-" + index, now - index * 1000)
  );

  const result = inspectGroupHistoryPage(messages, date, 1, 120);
  assert.equal(result.continue, true);
  assert.equal(result.cursor, "cursor-49");
  assert.equal(result.reason, "older-page-available");
});

test("WebSocket backfill stops after it reaches the start of the Vietnam day", () => {
  const date = "2026-11-12";
  const dayStart = vietnamDayStartMs(date);
  const messages = Array.from({ length: 50 }, (_, index) =>
    groupMessage("boundary-" + index, dayStart - (49 - index) * 1000)
  );

  const result = inspectGroupHistoryPage(messages, date, 2, 120);
  assert.equal(result.continue, false);
  assert.equal(result.reason, "day-boundary-reached");
});

test("WebSocket backfill stops when Zalo returns fewer than one full page", () => {
  const date = "2026-11-12";
  const now = Date.parse("2026-11-12T12:00:00+07:00");
  const messages = Array.from({ length: 12 }, (_, index) =>
    groupMessage("short-" + index, now - index * 1000)
  );

  const result = inspectGroupHistoryPage(messages, date, 1, 120);
  assert.equal(result.continue, false);
  assert.equal(result.reason, "history-exhausted");
});

test("WebSocket backfill stops safely at the configured page cap", () => {
  const date = "2026-11-12";
  const now = Date.parse("2026-11-12T12:00:00+07:00");
  const messages = Array.from({ length: 50 }, (_, index) =>
    groupMessage("cap-" + index, now - index * 1000)
  );

  const result = inspectGroupHistoryPage(messages, date, 120, 120);
  assert.equal(result.continue, false);
  assert.equal(result.reason, "page-limit");
});

test("an empty WebSocket history response is not proof of complete daily coverage", () => {
  const result = inspectGroupHistoryPage([], "2026-11-12", 1, 120);
  assert.equal(result.reason, "empty-page");
  assert.equal(isHistoryCoverageComplete(result.reason), false);
  assert.equal(isHistoryCoverageComplete("missing-timestamps"), false);
  assert.equal(isHistoryCoverageComplete("response-timeout"), false);
  assert.equal(isHistoryCoverageComplete("history-exhausted"), true);
  assert.equal(isHistoryCoverageComplete("day-boundary-reached"), true);
});


test("an empty WebSocket response is not proof of complete daily history", () => {
  const { isHistoryCoverageComplete } = require("../core/topchat/wsBackfill");
  const result = inspectGroupHistoryPage([], "2026-11-12", 1, 120);
  assert.equal(result.reason, "empty-page");
  assert.equal(isHistoryCoverageComplete(result.reason), false);
  assert.equal(isHistoryCoverageComplete("missing-timestamps"), false);
  assert.equal(isHistoryCoverageComplete("response-timeout"), false);
  assert.equal(isHistoryCoverageComplete("history-exhausted"), true);
  assert.equal(isHistoryCoverageComplete("day-boundary-reached"), true);
});
