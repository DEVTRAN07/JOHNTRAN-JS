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

test("all shared canvas colors follow the selected /menu theme", () => {
  theme.reload();
  const selected = menuPalette.getPalette();
  assert.equal(theme.PALETTE.accent, selected.accent);
  assert.equal(theme.PALETTE.bg0, selected.background[0]);
  assert.equal(theme.PALETTE.bg1, selected.background[1]);
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
