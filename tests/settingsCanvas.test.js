"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { renderCanvas } = require("../core/canvas/workerRender");
const workerPool = require("../core/workerPool");
after(async () => { await workerPool.shutdown(); });

function assertPng(file) {
  const buffer = fs.readFileSync(file);
  assert.ok(buffer.length > 1000, "canvas card should contain image data");
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
}

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
  try { assertPng(file); } finally { try { fs.unlinkSync(file); } catch {} }
});

test("events allowed-host card renders empty and populated lists", async () => {
  for (const hosts of [[], ["example.com", "news.example.org"]]) {
    const file = await renderCanvas("events", { mode: "hosts", hosts, prefix: "/" }, { timeout: 20000, poolSize: 1 });
    try { assertPng(file); } finally { try { fs.unlinkSync(file); } catch {} }
  }
});

test("theme card renders all supported presets with the active selection", async () => {
  const palette = require("../core/canvas/menuPalette");
  const file = await renderCanvas("theme", {
    current: palette.getThemeInfo(),
    presets: palette.getPresetList()
  }, { timeout: 20000, poolSize: 1 });
  try { assertPng(file); } finally { try { fs.unlinkSync(file); } catch {} }
});
