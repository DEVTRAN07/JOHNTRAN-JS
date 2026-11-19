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


test("welcome renderer prepares the selected shared photo theme before drawing a card", async () => {
  const themeBackgrounds = require("../core/canvas/themeBackgrounds");
  const originalPrepare = themeBackgrounds.prepare;
  const calls = [];
  themeBackgrounds.prepare = async options => {
    calls.push(options);
    return { activeName: "Test wallpaper", activeId: "test" };
  };
  let file;
  try {
    file = await welcome.renderWelcomeCard({
      mode: "welcome",
      member: { name: "Theme Test" },
      groupName: "JOHNTRAN"
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], undefined);
    assert.ok(fs.statSync(file).size > 1000);
  } finally {
    themeBackgrounds.prepare = originalPrepare;
    if (file) try { fs.rmSync(file, { force: true }); } catch {}
  }
});

test("concurrent welcome cards share one in-flight theme preparation", async () => {
  const themeBackgrounds = require("../core/canvas/themeBackgrounds");
  const originalPrepare = themeBackgrounds.prepare;
  let calls = 0;
  let release;
  themeBackgrounds.prepare = async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return { activeName: "Test wallpaper", activeId: "test" };
  };
  const files = [];
  try {
    const first = welcome.renderWelcomeCard({ mode: "welcome", member: { name: "One" } });
    const second = welcome.renderWelcomeCard({ mode: "welcome", member: { name: "Two" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    files.push(await first, await second);
  } finally {
    themeBackgrounds.prepare = originalPrepare;
    for (const file of files) try { fs.rmSync(file, { force: true }); } catch {}
  }
});


test("goodbye Canvas renders its own OUT message using the same one-person layout", async () => {
  const file = await welcome.renderWelcomeCard({
    mode: "goodbye",
    member: { name: "Hoàng Tùng" },
    groupName: "Tổ cu 5 - Bot dép lào"
  });
  try {
    const image = await loadImage(fs.readFileSync(file));
    assert.equal(image.width, theme.WIDTH);
    assert.equal(image.height, theme.S(220));
    assert.ok(fs.statSync(file).size > 1000);
  } finally {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
});

test("welcome status card presents JOIN and OUT as one combined switch", async () => {
  const enabled = await welcome.renderWelcomeCard({
    mode: "status",
    enabled: true,
    goodbyeEnabled: true
  });
  const legacyMismatch = await welcome.renderWelcomeCard({
    mode: "status",
    enabled: true,
    goodbyeEnabled: false
  });
  try {
    assert.ok(fs.statSync(enabled).size > 1000);
    assert.ok(fs.statSync(legacyMismatch).size > 1000);
    const source = fs.readFileSync(require.resolve("../core/canvas/welcome"), "utf8");
    assert.ok(source.includes("JOIN + OUT  ·  ĐANG BẬT"));
    assert.ok(source.includes("CHƯA ĐỒNG BỘ"));
    assert.ok(source.includes("Một lệnh duy nhất điều khiển cả JOIN và OUT"));
    assert.ok(source.includes("welcome on    ·  Bật JOIN + OUT"));
    assert.ok(source.includes("welcome off   ·  Tắt JOIN + OUT"));
    assert.ok(source.includes("Tạm biệt "));
  } finally {
    for (const file of [enabled, legacyMismatch]) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  }
});
