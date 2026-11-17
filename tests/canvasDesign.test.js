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
  assert.equal(theme.PALETTE.accent, "#61d8f2");
  assert.equal(theme.PALETTE.bg0, "#08111f");
  assert.equal(theme.getCardPalette().accent, "#61d8f2", "non-menu cards keep their ocean accent when /theme changes");
  assert.equal(theme.getCardPalette().background[0], "#08111f");
  const source = fs.readFileSync(require.resolve("../core/canvas/theme"), "utf8");
  const legacyProfile = fs.readFileSync(require.resolve("../core/canvas/profile"), "utf8");
  const macWindow = fs.readFileSync(require.resolve("../core/canvas/macWindow"), "utf8");
  assert.doesNotMatch(source, /^const menuPalette\s*=/m);
  assert.ok(!source.includes("BG_IMAGE"));
  assert.ok(!source.includes("theme.jpg"));
  assert.ok(!source.includes("loadImage"));
  assert.ok(!macWindow.includes("menuPalette"));
  assert.ok(!macWindow.includes("theme.jpg"));
  assert.doesNotMatch(source, /withMacWindow/);
  assert.match(source, /canvas\.toBuffer\("image\/png"\)/);
  assert.ok(!legacyProfile.includes("BG_IMAGE"));
  assert.ok(!legacyProfile.includes("theme.jpg"));
  const topchat = fs.readFileSync(require.resolve("../core/canvas/topchat"), "utf8");
  assert.ok(!topchat.includes("theme.jpg"));
  assert.ok(!topchat.includes("BG_IMAGE"));
  for (const relative of ["../core/canvas/index", "../core/canvas/monitoring", "../core/canvas/settings", "../core/canvas/profile"]) {
    const exporter = fs.readFileSync(require.resolve(relative), "utf8");
    assert.doesNotMatch(exporter, /withMacWindow/, relative + " must not wrap card images in a desktop window");
  }
});

test("/menu, folder cards and shared Canvas outputs are saved without desktop chrome", async () => {
  const canvas = createCanvas(theme.WIDTH, 80);
  const paths = [
    theme.save(canvas, "menu"),
    theme.save(canvas, "menu_folder"),
    theme.save(canvas, "status")
  ];

  try {
    for (const filePath of paths) {
      const image = await loadImage(fs.readFileSync(filePath));
      assert.equal(image.width, theme.WIDTH);
      assert.equal(image.height, canvas.height, "Canvas export must not add a macOS title bar");
      const surface = createCanvas(image.width, image.height);
      const ctx = surface.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixel = Array.from(ctx.getImageData(Math.floor(image.width / 2), 5, 1, 1).data);
      assert.equal(pixel[3], 0, "raw canvas transparency must be preserved");
    }
  } finally {
    for (const filePath of paths) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

test("profile and generic cards render as standalone Zalo attachments", async () => {
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
    const scale = theme.WIDTH / 750;
    assert.ok(profileImage.height > 300 * scale && profileImage.height < 600 * scale, "profile output must not include the extra desktop chrome");
    assert.ok(genericImage.height > 300 * scale && genericImage.height < 520 * scale, "generic output must be saved at its designed height");

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
      centerPixel[2] > centerPixel[0] && centerPixel[0] < 70,
      "generic card face must use the new dark navy surface"
    );
  } finally {
    try { fs.unlinkSync(profilePath); } catch {}
    try { fs.unlinkSync(genericPath); } catch {}
  }
});


test("main menu and folder cards both render without macOS window chrome", async () => {
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
    for (const [filePath, name] of [[menuPath, "main menu"], [folderPath, "folder card"]]) {
      const image = await loadImage(fs.readFileSync(filePath));
      assert.equal(image.width, theme.WIDTH);
      assert.ok(image.height > Math.round(200 * scale));
      const surface = createCanvas(image.width, image.height);
      const context = surface.getContext("2d");
      context.drawImage(image, 0, 0);
      const dot = Array.from(context.getImageData(
        Math.round(21 * scale), Math.round(22 * scale), 1, 1
      ).data).slice(0, 3);
      assert.notDeepEqual(dot, [255, 95, 87], name + " must not contain the Mac close dot");
      const maxDesignedHeight = name === "main menu" ? 560 : 360;
      assert.ok(image.height < Math.round(maxDesignedHeight * scale), name + " should not include the 58px desktop toolbar");
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
