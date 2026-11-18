"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { renderCanvas } = require("../core/canvas/workerRender");
const workerPool = require("../core/workerPool");
after(async () => { await workerPool.shutdown(); });
function assertPng(file) {
  const png = fs.readFileSync(file);
  assert.ok(png.length > 1000);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
}
test("Canvas worker renders stats as a standalone card image", async () => {
  const file = await renderCanvas("stats", {
    uptime: "1 phút",
    daily: { day: "2026-11-16", commands: 2, errors: 0, musicSearch: 0, musicDownload: 0, aiRequests: 0, ttsRequests: 0 },
    latency: { count: 2, avgMs: 194.6, p50Ms: 194.6, p95Ms: 194.6, lastMs: 194.6 },
    firstResponse: { count: 2, avgMs: 145.2, p50Ms: 120.4, p95Ms: 170.1 },
    listenerStages: [
      { command: "thread-data", p95Ms: 9.4 },
      { command: "receive-to-command", p95Ms: 15.8 }
    ],
    apiCalls: [{ command: "sendmessage", p95Ms: 178.2 }, { command: "addreaction", p95Ms: 42.1 }],
    topCommands: [["noitu", 1], ["stats", 1]],
    slowCommands: [{ command: "noitu", p95Ms: 194.6, avgMs: 194.6 }],
    slowHandlers: [{ command: "noitu", p95Ms: 189.63, avgMs: 189.63 }],
    caches: [{ name: "threadCache", size: 6, max: 1000, hitRate: .81 }, { name: "userCache", size: 1, max: 1000, hitRate: .5 }]
  }, { timeout: 20000, poolSize: 1 });
  try { assertPng(file); } finally { try { fs.unlinkSync(file); } catch {} }
});
test("Canvas worker renders jobs with empty queue and worker states", async () => {
  const file = await renderCanvas("jobs", {
    uptime: "1 phút", global: { active: 0, pending: 0, concurrency: 4, maxPending: 80 },
    lanes: [], workers: [],
    caches: [{ name: "threadCache", size: 6, max: 1000, hitRate: .86 }, { name: "userCache", size: 1, max: 1000, hitRate: .67 }, { name: "groupInfo", size: 6, max: 200, hitRate: 0 }],
    media: { localFiles: 0, hitRate: 0, uploads: 0, r2Configured: false },
    memory: { rssMb: 97.5, heapMb: 23.7 }
  }, { timeout: 20000, poolSize: 1 });
  try { assertPng(file); } finally { try { fs.unlinkSync(file); } catch {} }
});
