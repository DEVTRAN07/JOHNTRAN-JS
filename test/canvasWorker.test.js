const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, test } = require("node:test");
const { renderCanvas } = require("../core/canvas/workerRender");
const workerPool = require("../core/workerPool");

after(async () => {
  await workerPool.shutdown();
});

test("canvas worker renders a valid music card PNG", async () => {
  const outputPath = await renderCanvas(
    "music-nowplaying",
    {
      track: {
        title: "JOHNTRAN worker test",
        artist: "Regression Suite",
        duration: 42,
        thumbnail: ""
      },
      sourceLabel: "TEST"
    },
    { timeout: 20000, poolSize: 1 }
  );

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "rendered PNG should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "rendered file should have the PNG signature"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* already removed */ }
  }
});

test("canvas worker renders a cultivation profile card PNG", async () => {
  const { renderTuTienCard } = require("../core/canvas/workerRender");
  const outputPath = await renderTuTienCard({
    kind: "profile",
    name: "Đạo hữu thử nghiệm",
    realm: "Trúc Cơ · Sơ kỳ",
    cultivation: 120,
    required: 200,
    stones: 80,
    hp: "125/125",
    attack: 15,
    defense: 8
  }, { timeout: 20000, poolSize: 1 });

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 5000, "cultivation card should contain image data");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* already removed */ }
  }
});
