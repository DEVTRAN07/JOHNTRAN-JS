"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadImage } = require("canvas");
const theme = require("../core/canvas/theme");
const welcome = require("../core/canvas/welcome");

test("welcome Canvas renders a dedicated Zalo card with group and member names", async () => {
  const filePath = welcome.renderWelcomeCard({
    mode: "welcome",
    memberNames: ["Member One", "Member Two"],
    groupName: "JOHNTRAN Community"
  });
  try {
    const image = await loadImage(fs.readFileSync(filePath));
    assert.equal(image.width, theme.WIDTH);
    assert.ok(image.height >= theme.S(510) && image.height < theme.S(700));
  } finally {
    try { fs.rmSync(filePath, { force: true }); } catch {}
  }
});

test("welcome Canvas renders both enabled and disabled settings cards", () => {
  const onPath = welcome.renderWelcomeCard({ mode: "status", enabled: true });
  const offPath = welcome.renderWelcomeCard({ mode: "status", enabled: false });
  try {
    assert.ok(fs.statSync(onPath).size > 1000);
    assert.ok(fs.statSync(offPath).size > 1000);
  } finally {
    for (const filePath of [onPath, offPath]) {
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
  }
});
