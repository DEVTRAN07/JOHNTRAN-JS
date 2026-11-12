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

test("canvas worker renders a valid SoundCloud search grid PNG", async () => {
  const outputPath = await renderCanvas(
    "music-grid",
    {
      query: "JOHNTRAN card test",
      tracks: [
        { id: "1", title: "Track One", artist: "Artist One", duration: 125, thumbnail: "", plays: 12000, likes: 250 },
        { id: "2", title: "Track Two", artist: "Artist Two", duration: 187, thumbnail: "", plays: 8000, likes: 300 }
      ],
      options: { page: 1, totalPages: 2, source: "SOUNDCLOUD" }
    },
    { timeout: 20000, poolSize: 1 }
  );

  try {
    const png = fs.readFileSync(outputPath);
    assert.ok(png.length > 1000, "search card PNG should contain image data");
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      "search card should have the PNG signature"
    );
  } finally {
    try { fs.unlinkSync(outputPath); } catch { /* already removed */ }
  }
});
