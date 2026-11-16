"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { renderCanvas } = require("../core/canvas/workerRender");
const workerPool = require("../core/workerPool");
after(async () => { await workerPool.shutdown(); });

test("events status card renders the four group automation modules", async () => {
  const file = await renderCanvas("events", {
    mode: "status",
    prefix: "/",
    events: [
      { key: "welcome", label: "Chào thành viên mới", enabled: true },
      { key: "bye", label: "Tạm biệt thành viên", enabled: false },
      { key: "rank", label: "Level / EXP", enabled: true },
      { key: "guard", label: "Cảnh cáo link", enabled: false }
    ]
  }, { timeout: 20000, poolSize: 1 });
  try {
    const buffer = fs.readFileSync(file);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
});

test("settings Canvas renderer and worker expose host-list and theme cards", () => {
  const renderer = require("../core/canvas/settings");
  const workerSource = fs.readFileSync(require.resolve("../core/workers/canvasWorker"), "utf8");
  assert.equal(typeof renderer.renderEventSettings, "function");
  assert.equal(typeof renderer.renderThemeSettings, "function");
  assert.match(workerSource, /case "events":/);
  assert.match(workerSource, /case "theme":/);
});
