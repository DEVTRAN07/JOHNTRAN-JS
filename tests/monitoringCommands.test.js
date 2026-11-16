"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const workerRender = require("../core/canvas/workerRender");
const original = workerRender.renderCanvas;
const calls = [], sent = [];
workerRender.renderCanvas = async (type, data) => {
  const file = path.join(os.tmpdir(), "jt-monitor-command-" + process.pid + "-" + calls.length + ".png");
  fs.writeFileSync(file, "mock");
  calls.push({ type, data, file });
  return file;
};
const stats = require("../plugins/commands/stats");
const jobs = require("../plugins/commands/jobs");
after(() => {
  workerRender.renderCanvas = original;
  for (const call of calls) { try { fs.unlinkSync(call.file); } catch {} }
});
function makeApi() {
  return { async sendMessage(payload, threadId, type) { sent.push({ payload, threadId, type }); return { ok: true }; } };
}
test("/stats sends a Canvas attachment and retains its metrics data", async () => {
  await stats.run({ api: makeApi(), event: { threadId: "stats-thread", type: 1 }, reply: { text: async v => { throw new Error(v); } } });
  const card = calls.find(v => v.type === "stats");
  assert.ok(card && card.data.daily && Array.isArray(card.data.caches));
  assert.equal(sent[0].payload.ttlKind, "card");
  assert.equal(sent[0].threadId, "stats-thread");
  assert.ok(Array.isArray(sent[0].payload.attachments));
});
test("/jobs sends a Canvas attachment with queue, worker, cache and memory snapshots", async () => {
  await jobs.run({ api: makeApi(), event: { threadId: "jobs-thread", type: 1 } });
  const card = calls.find(v => v.type === "jobs");
  assert.ok(card && Array.isArray(card.data.lanes) && Array.isArray(card.data.workers));
  assert.ok(Array.isArray(card.data.caches) && card.data.memory);
  assert.equal(sent[1].payload.ttlKind, "card");
  assert.equal(sent[1].threadId, "jobs-thread");
});
test("stats and jobs keep readable text fallbacks", () => {
  assert.match(stats._test.buildText({ day: "2026-11-16" }, {}, [], null, [], []), /THỐNG KÊ HOẠT ĐỘNG/);
  assert.match(jobs._test.buildText({}, {}, {}, { localFiles: 0, hitRate: 0, uploads: 0 }, { rss: 1024, heapUsed: 512 }), /SPEED ENGINE/);
});
