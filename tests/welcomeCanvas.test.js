"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { loadImage } = require("canvas");
const theme = require("../core/canvas/theme"), welcome = require("../core/canvas/welcome");
test("welcome Canvas renders one personalized wide card for one member", async () => {
  const file = await welcome.renderWelcomeCard({ mode: "welcome", member: { name: "Hoàng Tùng" }, groupName: "Tổ cu 5 - Bot dép lào" });
  try {
    const image = await loadImage(fs.readFileSync(file));
    assert.equal(image.width, theme.WIDTH); assert.equal(image.height, theme.S(220));
    assert.ok(image.width / image.height > 3.2);
  } finally { try { fs.rmSync(file, { force: true }); } catch {} }
});
test("welcome Canvas follows the shared one-person photo layout", () => {
  const source = fs.readFileSync(require.resolve("../core/canvas/welcome"), "utf8");
  assert.ok(source.includes("avatarCache.warmAvatar")); assert.ok(source.includes("drawMemberAvatar"));
  assert.ok(source.includes("One full-bleed theme photo")); assert.ok(!source.includes("theme.panel"));
});
test("welcome member normalization prefers full Zalo avatar and sanitizes names", () => {
  assert.deepEqual(welcome._test.normalizeMember({ member: {
    name: "  Hoàng\n Tùng  ", avatar: "https://example.com/full.jpg", avatar_25: "https://example.com/small.jpg"
  }}), { name: "Hoàng Tùng", avatarUrl: "https://example.com/full.jpg" });
});
test("welcome Canvas renders both enabled and disabled settings cards", async () => {
  const on = await welcome.renderWelcomeCard({ mode: "status", enabled: true });
  const off = await welcome.renderWelcomeCard({ mode: "status", enabled: false });
  try { assert.ok(fs.statSync(on).size > 1000); assert.ok(fs.statSync(off).size > 1000); }
  finally { for (const file of [on, off]) try { fs.rmSync(file, { force: true }); } catch {} }
});
