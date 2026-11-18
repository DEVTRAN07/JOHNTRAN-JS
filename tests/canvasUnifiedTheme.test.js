"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const brandTheme = require("../core/canvas/brandTheme");
const themeBackgrounds = require("../core/canvas/themeBackgrounds");
const menu = require("../core/canvas/menu");
const theme = require("../core/canvas/theme");
const settings = require("../core/canvas/settings");

test("the brand palette stays Aurora Cyber while /theme changes photo selection", () => {
  const menuPalette = menu._test.getMainMenuPalette();
  const cardPalette = theme.getCardPalette();

  assert.equal(menuPalette.label, "JOHNTRAN · Aurora Cyber");
  assert.equal(menuPalette.accent, "#62dcff");
  assert.equal(cardPalette.accent, menuPalette.accent);
  assert.deepEqual(cardPalette.background, menuPalette.background);
  assert.deepEqual(cardPalette.panel, menuPalette.panel);
  assert.deepEqual(cardPalette.card, menuPalette.card);
  assert.deepEqual(brandTheme.getPalette().footer, menuPalette.footer);

  assert.equal(themeBackgrounds.normalizeSelection("1"), "1");
  assert.equal(themeBackgrounds.normalizeSelection("2"), "2");
  assert.equal(themeBackgrounds.normalizeSelection("3"), "3");
  assert.equal(themeBackgrounds.normalizeSelection("random"), "random");
  assert.equal(themeBackgrounds.normalizeSelection("reset"), "random");
  assert.equal(themeBackgrounds.normalizeSelection("next", "2"), "3");
  assert.equal(themeBackgrounds.normalizeSelection("invalid"), null);
});

test("theme library contains the three requested photo sources and a local cache folder", () => {
  const backgrounds = themeBackgrounds.getBackgrounds();
  assert.equal(backgrounds.length, 3);
  assert.deepEqual(backgrounds.map(item => item.id), ["1", "2", "3"]);
  assert.match(backgrounds[0].url, /hinh-nen-gai-xinh-sexy-27\\.jpg$/);
  assert.match(backgrounds[1].url, /hinh-nen-gai-xinh-sexy-18\\.jpg$/);
  assert.match(backgrounds[2].url, /hinh-nen-gai-xinh-sexy-16\\.jpg$/);
  assert.ok(fs.existsSync(path.join(themeBackgrounds.THEME_DIR, "README.md")));
});

test("shared Aurora background and translucent glass panels render a valid PNG", () => {
  const { canvas, ctx } = theme.newCanvas(750, 500);
  theme.paintBackground(ctx, 750, 500);
  theme.panel(ctx, 28, 28, 694, 120, 16, theme.PALETTE.accent);
  theme.panel(ctx, 28, 165, 335, 120, 14, theme.PALETTE.accent);
  theme.panel(ctx, 377, 165, 345, 120, 14, theme.PALETTE.accent);

  const png = canvas.toBuffer("image/png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 1000);
});

test("theme gallery renderer and Anti renderer generate valid PNGs", t => {
  const outputs = [];
  const gallery = settings.renderThemeSettings({});
  outputs.push(gallery);
  const anti = settings.renderAntiProtectionCardV2({
    prefix: "/",
    items: [
      { key: "anti_nude", label: "Chặn nội dung nhạy cảm", detail: "AI quét ảnh 18+", command: "/antinude", icon: "18+", tone: "#e83f9e", enabled: true },
      { key: "anti_undo", label: "Chống thu hồi tin nhắn", detail: "Khôi phục chữ, ảnh, video, voice", command: "/antirecall", icon: "↶", tone: "#a94ce5", enabled: true },
      { key: "anti_link", label: "Chặn tất cả link", detail: "Chặn đường dẫn trong nhóm", command: "/anti link", icon: "URL", tone: "#08aeba", enabled: false }
    ]
  });
  outputs.push(anti);

  for (const file of outputs) {
    const png = fs.readFileSync(file);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(png.length > 1000);
  }
  t.after(() => {
    for (const file of outputs) {
      try { fs.unlinkSync(file); } catch {}
    }
  });
});
