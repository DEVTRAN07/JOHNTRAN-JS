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

test("Anti-Protection canvas renders the six live moderation features with statuses", async () => {
  const file = await renderCanvas("anti-protection", {
    prefix: "/",
    items: [
      { key:"anti_nude", label:"Chặn nội dung nhạy cảm", icon:"18+", tone:"#e83f9e", enabled:true },
      { key:"anti_undo", label:"Chống thu hồi tin nhắn", icon:"↶", tone:"#a94ce5", enabled:false },
      { key:"anti_danger_link", label:"Chặn link nguy hiểm", icon:"↗", tone:"#138fe5", enabled:true },
      { key:"anti_sticker_spam", label:"Chống dội bom sticker", icon:"ST", tone:"#f18b1c", enabled:false },
      { key:"anti_link", label:"Chặn tất cả link", icon:"URL", tone:"#08aeba", enabled:false },
      { key:"anti_spam", label:"Chống spam tin nhắn", icon:"SP", tone:"#e4b91e", enabled:true }
    ]
  }, { timeout:20000, poolSize:1 });
  try {
    const buffer = fs.readFileSync(file);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.subarray(0,8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
});

test("Anti-Protection canvas renderer is registered in the worker", () => {
  const renderer = require("../core/canvas/settings");
  const workerSource = fs.readFileSync(require.resolve("../core/workers/canvasWorker"), "utf8");
  assert.equal(typeof renderer.renderAntiProtectionCard, "function");
  assert.match(workerSource, /case "anti-protection":/);
});
