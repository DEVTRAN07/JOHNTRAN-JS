"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const brandTheme = require("../core/canvas/brandTheme");
const menuPalette = require("../core/canvas/menuPalette");
const menu = require("../core/canvas/menu");
const theme = require("../core/canvas/theme");
const settings = require("../core/canvas/settings");

function temporaryThemeFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-unified-theme-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "menu-theme.json");
}

test("all cards use the current main-menu Blue Neon default when no /theme is saved", t => {
  const file = temporaryThemeFile(t);
  const palette = brandTheme.getPalette(file);

  assert.equal(palette.label, "JOHNTRAN · Blue Neon");
  assert.equal(palette.accent, "#62dcff");
  assert.deepEqual(palette.background, ["#030914", "#07182d", "#102b4b", "#040d1d"]);
});

test("/theme selection is reused by the unified canvas brand palette", t => {
  const file = temporaryThemeFile(t);

  menuPalette.setTheme("purple", file);
  const palette = brandTheme.getPalette(file);
  assert.equal(palette.label, menuPalette.PRESETS.purple.label);
  assert.equal(palette.accent, "#c4a4ff");

  menuPalette.setTheme("#12abef", file);
  const custom = brandTheme.getPalette(file);
  assert.equal(custom.accent, "#12abef");
  assert.match(custom.border, /^rgba\(/);
});

test("main menu and generic Canvas renderers resolve the exact same palette", () => {
  const menuPaletteNow = menu._test.getMainMenuPalette();
  const cardPaletteNow = theme.getCardPalette();

  assert.equal(menuPaletteNow.accent, cardPaletteNow.accent);
  assert.deepEqual(menuPaletteNow.background, cardPaletteNow.background);
  assert.deepEqual(menuPaletteNow.panel, cardPaletteNow.panel);
  assert.deepEqual(menuPaletteNow.card, cardPaletteNow.card);
  assert.deepEqual(menuPaletteNow.footer, cardPaletteNow.footer);
});

test("shared Canvas background and raised panels render a valid PNG", () => {
  const { canvas, ctx } = theme.newCanvas(750, 500);
  theme.paintBackground(ctx, 750, 500);
  theme.panel(ctx, 28, 28, 694, 120, 16, theme.PALETTE.accent);
  theme.panel(ctx, 28, 165, 335, 120, 14, theme.PALETTE.accent);
  theme.panel(ctx, 377, 165, 345, 120, 14, theme.PALETTE.accent);

  const png = canvas.toBuffer("image/png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 1000);
});

test("Anti V2 and the legacy Anti renderer both use the unified Canvas theme", t => {
  const outputs = [];
  const sample = {
    prefix: "/",
    items: [
      { key: "anti_nude", label: "Chặn nội dung nhạy cảm", detail: "AI quét ảnh 18+", command: "/antinude", icon: "18+", tone: "#e83f9e", enabled: true },
      { key: "anti_undo", label: "Chống thu hồi tin nhắn", detail: "Khôi phục nội dung", command: "/antirecall", icon: "↶", tone: "#a94ce5", enabled: true },
      { key: "anti_link", label: "Chặn tất cả link", detail: "Chặn đường dẫn trong nhóm", command: "/anti link", icon: "URL", tone: "#08aeba", enabled: false }
    ]
  };

  for (const render of [settings.renderAntiProtectionCardV2, settings.renderAntiProtectionCard]) {
    const file = render(sample);
    outputs.push(file);
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
