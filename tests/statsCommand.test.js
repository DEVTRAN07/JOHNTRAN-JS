"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/stats");

test("stats text reports first-response time separately from Zalo send RTT", () => {
  const text = command._test.buildText(
    { day: "2026-11-18", commands: 4, errors: 0, musicSearch: 0, musicDownload: 0, aiRequests: 0, ttsRequests: 0 },
    {},
    [],
    { count: 4, p50Ms: 30, p95Ms: 60, lastMs: 25 },
    [],
    [],
    [{ command: "menu", count: 3, avgMs: 95, p95Ms: 120 }],
    { count: 4, success: 4, failed: 0, avgMs: 42, p95Ms: 70 }
  );

  assert.match(text, /PHẢN HỒI ĐẦU TIÊN/);
  assert.match(text, /menu: P95 120 ms/);
  assert.match(text, /Zalo send RTT: P95 70 ms/);
});
