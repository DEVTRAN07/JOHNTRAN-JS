"use strict";

const { ThreadType } = require("zalo-client");
const { messageTimestamp, isGroupMessage } = require("./stats");

const HISTORY_PAGE_SIZE = 50;
const HISTORY_PAGE_DELAY_MS = 350;
const HISTORY_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_MAX_PAGES = 120;

function maxHistoryPages(value = process.env.JT_TOPCHAT_MAX_HISTORY_PAGES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PAGES;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function vietnamDayStartMs(dateKey) {
  const value = Date.parse(String(dateKey || "") + "T00:00:00+07:00");
  return Number.isFinite(value) ? value : 0;
}

function isHistoryCoverageComplete(reason) {
  // An empty response or missing timestamps does not prove that today's
  // history was fully scanned; Zalo may have returned an unusable page.
  return reason === "day-boundary-reached" || reason === "history-exhausted";
}

function inspectGroupHistoryPage(messages, dateKey, pageNumber = 1, maxPages = DEFAULT_MAX_PAGES) {
  const list = Array.isArray(messages)
    ? messages.filter(isGroupMessage)
    : [];

  if (!list.length) {
    return { continue: false, cursor: null, oldestTimestamp: 0, reason: "empty-page" };
  }

  const dated = list
    .map(message => ({
      message,
      timestamp: messageTimestamp(message?.data?.ts ?? message?.data?.timestamp),
      cursor: String(message?.data?.msgId || message?.data?.actionId || "")
    }))
    .filter(item => item.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!dated.length) {
    return { continue: false, cursor: null, oldestTimestamp: 0, reason: "missing-timestamps" };
  }

  const oldest = dated[0];
  const dayStart = vietnamDayStartMs(dateKey);
  if (dayStart && oldest.timestamp <= dayStart) {
    return {
      continue: false,
      cursor: null,
      oldestTimestamp: oldest.timestamp,
      reason: "day-boundary-reached"
    };
  }

  if (list.length < HISTORY_PAGE_SIZE) {
    return {
      continue: false,
      cursor: null,
      oldestTimestamp: oldest.timestamp,
      reason: "history-exhausted"
    };
  }

  if (pageNumber >= maxPages) {
    return {
      continue: false,
      cursor: null,
      oldestTimestamp: oldest.timestamp,
      reason: "page-limit"
    };
  }

  if (!oldest.cursor) {
    return {
      continue: false,
      cursor: null,
      oldestTimestamp: oldest.timestamp,
      reason: "missing-cursor"
    };
  }

  return {
    continue: true,
    cursor: oldest.cursor,
    oldestTimestamp: oldest.timestamp,
    reason: "older-page-available"
  };
}

module.exports = {
  HISTORY_PAGE_SIZE,
  HISTORY_PAGE_DELAY_MS,
  HISTORY_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_PAGES,
  maxHistoryPages,
  vietnamDayStartMs,
  inspectGroupHistoryPage,
  isHistoryCoverageComplete
};
