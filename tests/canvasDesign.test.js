"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadImage } = require("canvas");
const { test } = require("node:test");
const theme = require("../core/canvas/theme");
const menuPalette = require("../core/canvas/menuPalette");
const profileCard = require("../core/canvas/profileCard");
const { renderCardToFile } = require("../core/canvas");

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
  } finally {
    try { fs.unlinkSync(profilePath); } catch {}
    try { fs.unlinkSync(genericPath); } catch {}
  }
});
