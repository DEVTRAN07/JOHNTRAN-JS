"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { renderStatsCard } = require("../core/canvas/monitoring");

test("stats Canvas renders first-response and Zalo send latency panels", t => {
  const imagePath = renderStatsCard({
    daily: { day: "2026-11-18", commands: 20, errors: 0 },
    latency: { count: 20, p50Ms: 90, p95Ms: 240, lastMs: 85, avgMs: 110 },
    firstResponses: [
      { command: "menu", count: 8, avgMs: 75, p50Ms: 60, p95Ms: 120, maxMs: 130 }
    ],
    zaloSend: { count: 20, success: 20, failed: 0, avgMs: 35, p50Ms: 30, p95Ms: 55, maxMs: 60, lastMs: 32 },
    topCommands: [["menu", 8]],
    slowCommands: [],
    slowHandlers: [],
    caches: [],
    uptime: "1 phút"
  });
  t.after(() => { try { fs.rmSync(imagePath, { force: true }); } catch {} });

  assert.equal(typeof imagePath, "string");
  assert.ok(fs.existsSync(imagePath));
  assert.ok(fs.statSync(imagePath).size > 1000);
});
