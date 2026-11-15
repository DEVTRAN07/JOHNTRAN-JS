"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createCanvas, loadImage } = require("canvas");
const { test } = require("node:test");
const theme = require("../core/canvas/theme");
const menuPalette = require("../core/canvas/menuPalette");
const profileCard = require("../core/canvas/profileCard");
const { renderCardToFile } = require("../core/canvas");
const menuCanvas = require("../core/canvas/menu");
const musicCanvas = require("../core/canvas/music");

test("menu color themes stay isolated from non-menu Canvas cards", t => {
  theme.reload();
  const originalAccent = theme.PALETTE.accent;
  const originalBackground = theme.PALETTE.bg0;
  const directory = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "johntran-menu-only-theme-"));
  const file = require("node:path").join(directory, "menu-theme.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  menuPalette.setTheme("purple", file);
  theme.ensureTheme();

  assert.equal(menuPalette.getThemeInfo(file).name, "purple");
  assert.equal(theme.PALETTE.accent, originalAccent);
  assert.equal(theme.PALETTE.bg0, originalBackground);
  assert.equal(theme.PALETTE.accent, "#d4af37");
  assert.equal(theme.PALETTE.bg0, "#08080a");
  const source = fs.readFileSync(require.resolve("../core/canvas/theme"), "utf8");
  const legacyProfile = fs.readFileSync(require.resolve("../core/canvas/profile"), "utf8");
  const macWindow = fs.readFileSync(require.resolve("../core/canvas/macWindow"), "utf8");
  assert.doesNotMatch(source, /^const menuPalette\s*=/m);
  assert.ok(!source.includes("BG_IMAGE"));
  assert.ok(!source.includes("theme.jpg"));
  assert.ok(!source.includes("loadImage"));
  assert.ok(!macWindow.includes("menuPalette"));
  assert.ok(!macWindow.includes("theme.jpg"));
  assert.match(source, /const menuFrame = prefix === "menu" \|\| prefix === "menu_folder"/);
  assert.ok(!legacyProfile.includes("BG_IMAGE"));
  assert.ok(!legacyProfile.includes("theme.jpg"));
  const topchat = fs.readFileSync(require.resolve("../core/canvas/topchat"), "utf8");
  assert.ok(!topchat.includes("theme.jpg"));
  assert.ok(!topchat.includes("BG_IMAGE"));
});

test("/theme changes menu frames but leaves other Canvas frames unchanged", async t => {
  const originalGetPalette = menuPalette.getPalette;
  const fakePalette = {
    background: ["#123456", "#123456", "#123456", "#123456"],
    panel: ["#123456", "#123456"],
    footer: ["#123456", "#123456"],
    accent: "#123456",
    border: "#123456"
  };
  menuPalette.getPalette = () => fakePalette;
  const canvas = createCanvas(theme.WIDTH, 80);
  const statusPath = theme.save(canvas, "status");
  const menuPath = theme.save(canvas, "menu");

  async function readTopPixel(filePath) {
    const image = await loadImage(fs.readFileSync(filePath));
    const surface = createCanvas(image.width, image.height);
    const ctx = surface.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(Math.floor(image.width / 2), 5, 1, 1).data).slice(0, 3);
  }

  try {
    assert.deepEqual(await readTopPixel(menuPath), [18, 52, 86]);
    assert.notDeepEqual(await readTopPixel(statusPath), [18, 52, 86]);
  } finally {
    menuPalette.getPalette = originalGetPalette;
    try { fs.unlinkSync(statusPath); } catch {}
    try { fs.unlinkSync(menuPath); } catch {}
  }
});

test("profile and generic cards render with the shared Mac window frame", async () => {
  const profilePath = await profileCard.render({
    name: "Member Test",
    link: "member.test",
    rows: [
      ["Sinh nhật", "01/01/2000"],
      ["Giới tính", "Không công khai"],
      ["UID", "test-uid"]
    ]
  });
  const genericPath = renderCardToFile({
    chip: "JOHNTRAN",
    title: "Canvas test",
    subtitle: "Shared menu theme",
    sections: [{ title: "Thông tin", lines: ["Dòng kiểm thử thứ nhất", "Dòng kiểm thử thứ hai"] }],
    footer: "JOHNTRAN"
  });

  try {
    const profileImage = await loadImage(fs.readFileSync(profilePath));
    const genericImage = await loadImage(fs.readFileSync(genericPath));
    assert.equal(profileImage.width, theme.WIDTH);
    assert.equal(genericImage.width, theme.WIDTH);
    assert.ok(profileImage.height > 300);
    assert.ok(genericImage.height > 300);

    const genericCanvas = createCanvas(genericImage.width, genericImage.height);
    const genericContext = genericCanvas.getContext("2d");
    genericContext.drawImage(genericImage, 0, 0);
    const centerPixel = genericContext.getImageData(
      Math.floor(genericImage.width / 2),
      Math.floor(genericImage.height / 2),
      1,
      1
    ).data;
    assert.ok(
      Math.max(centerPixel[0], centerPixel[1], centerPixel[2]) < 45,
      "generic card face must use the shared dark surface, not a light gray fill"
    );
  } finally {
    try { fs.unlinkSync(profilePath); } catch {}
    try { fs.unlinkSync(genericPath); } catch {}
  }
});


test("menu and folder cards use the shared macOS card frame", async () => {
  const previousConfig = global.config;
  global.config = {
    ...(previousConfig || {}),
    prefix: previousConfig?.prefix || "/",
    canvas: {
      ...(previousConfig?.canvas || {}),
      width: theme.WIDTH,
      theme: previousConfig?.canvas?.theme || "editorial"
    }
  };
  theme.reload();

  const menuPath = await menuCanvas.renderMenuGrid({
    requesterName: "Preview Member",
    requesterAvatarUrl: "",
    botVersion: "4.0.0",
    commands: [{ name: "Tools", slug: "tools", category: "Công cụ hỗ trợ" }]
  });
  const folderPath = await menuCanvas.renderFolderCard({
    folderName: "Tools",
    folderSlug: "tools",
    folderDescription: "Công cụ tự động và xử lý tác vụ",
    requesterName: "Preview Member",
    requesterAvatarUrl: "",
    botVersion: "4.0.0"
  });

  try {
    const scale = theme.WIDTH / 750;
    for (const filePath of [menuPath, folderPath]) {
      const image = await loadImage(fs.readFileSync(filePath));
      const rendered = createCanvas(image.width, image.height);
      const ctx = rendered.getContext("2d");
      ctx.drawImage(image, 0, 0);
      assert.equal(image.width, theme.WIDTH);
      assert.ok(image.height > Math.round(200 * scale));
      const dot = ctx.getImageData(Math.round(21 * scale), Math.round(22 * scale), 1, 1).data;
      assert.deepEqual(Array.from(dot).slice(0, 3), [255, 95, 87]);
    }
  } finally {
    try { fs.unlinkSync(menuPath); } catch {}
    try { fs.unlinkSync(folderPath); } catch {}
    global.config = previousConfig;
    theme.reload();
  }
});

test("music search and now-playing cards have enough space for all metadata", async () => {
  const previousConfig = global.config;
  global.config = {
    ...(previousConfig || {}),
    prefix: previousConfig?.prefix || "/",
    canvas: {
      ...(previousConfig?.canvas || {}),
      width: theme.WIDTH,
      theme: previousConfig?.canvas?.theme || "editorial"
    }
  };
  theme.reload();

  const gridPath = await musicCanvas.renderSearchGrid(
    "nhạc Việt trending",
    [{
      title: "Một Ngày Nào Đó",
      artist: "JOHNTRAN Preview",
      thumbnail: "",
      plays: 128000,
      likes: 8400
    }],
    { page: 1, totalPages: 1, source: "SOUNDCLOUD" }
  );
  const nowPath = await musicCanvas.renderNowPlaying({
    title: "Một Ngày Nào Đó",
    artist: "JOHNTRAN Preview",
    duration: 214,
    thumbnail: ""
  }, "SOUNDCLOUD");

  try {
    const grid = await loadImage(fs.readFileSync(gridPath));
    const now = await loadImage(fs.readFileSync(nowPath));
    assert.equal(grid.width, theme.WIDTH);
    assert.equal(now.width, theme.WIDTH);
    assert.ok(now.height > grid.height, "now-playing card must leave room for title, artist, source and progress text");
  } finally {
    try { fs.unlinkSync(gridPath); } catch {}
    try { fs.unlinkSync(nowPath); } catch {}
    global.config = previousConfig;
    theme.reload();
  }
});
