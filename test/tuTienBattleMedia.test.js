"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const { createCanvas } = require("canvas");
const { drawFrame, renderBattleMedia, FRAME_COUNT } = require("../core/games/tuTienBattleMedia");

const battle = {
  fighters: [
    { uid: "1", name: "Đạo Hữu A", realm: "Kim Đan", hp: 180, maxHp: 300 },
    { uid: "2", name: "Đạo Hữu B", realm: "Trúc Cơ", hp: 120, maxHp: 300 }
  ]
};
const entry = {
  uid: "1", action: "skill", skill: "Thiên Lôi Chưởng",
  damage: 80, critical: true, dodged: false, enemyHp: 120
};

test("battle effect renderer paints an actual frame", () => {
  const canvas = createCanvas(640, 360);
  drawFrame(canvas.getContext("2d"), battle, entry, 8);
  const png = canvas.toBuffer("image/png");
  assert.ok(png.length > 1000);
  assert.equal(FRAME_COUNT, 16);
});

test("battle media renderer produces real GIF and MP4 files", async () => {
  const media = await renderBattleMedia(battle, entry);
  try {
    const gif = await fs.stat(media.gifPath);
    const video = await fs.stat(media.videoPath);
    const thumb = await fs.stat(media.thumbnailPath);
    assert.ok(gif.size > 500);
    assert.ok(video.size > 500);
    assert.ok(thumb.size > 500);
  } finally {
    await media.cleanup();
  }
});
