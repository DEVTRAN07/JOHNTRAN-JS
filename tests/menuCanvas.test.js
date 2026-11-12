const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadImage } = require("canvas");
const { test } = require("node:test");
const theme = require("../core/canvas/theme");
const { renderMenuGrid, _test: menuCanvasTestHelpers } = require("../core/canvas/menu");

test("menu renders individual command cards inside a macOS window", async () => {
  const filePath = await renderMenuGrid({
    requesterName: "Nguyễn Văn A",
    requesterAvatarUrl: "",
    botVersion: "1.2.0",
    prefix: "/",
    page: 1,
    totalPages: 1,
    totalCommands: 2,
    commands: [
      { name: "help", usage: "help", category: "Info" },
      { name: "play", usage: "play <tên nhạc>", category: "Music" }
    ]
  });

  try {
    const image = await loadImage(fs.readFileSync(filePath));
    const scale = theme.WIDTH / 750;
    assert.equal(image.width, theme.WIDTH);
    assert.ok(image.height > 44 * scale);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test("menu does not treat /menu <command> as a command-info shortcut", async () => {
  const command = require("../plugins/commands/menu");
  const previousConfig = global.config;
  const sent = [];
  global.config = { prefix: "/" };

  try {
    await command.run({
      api: { sendMessage: (...args) => sent.push(args) },
      event: { threadId: "thread", type: 1, data: { uidFrom: "12345" } },
      args: ["play"]
    });

    assert.match(sent[0][0].msg, /gõ next \/ prev/);
    assert.doesNotMatch(sent[0][0].msg, /\/menu next/);
    assert.doesNotMatch(sent[0][0].msg, /Cách dùng: play/);
  } finally {
    global.config = previousConfig;
  }
});

test("menu clock measures the time label and leaves a fixed visual gap", () => {
  const source = fs.readFileSync(require.resolve("../core/canvas/menu"), "utf8");
  assert.match(source, /const timeWidth = ctx\.measureText\(time\)\.width/);
  assert.match(source, /timeLeft - clockGap - clockSize \/ 2/);
});

test("presence badge stays attached to avatars of different sizes", () => {
  const { presenceBadgePosition } = require("../core/canvas/menu")._test;
  for (const size of [theme.S(40), theme.S(76)]) {
    const radius = theme.S(6.5);
    const point = presenceBadgePosition(10, 20, size, radius);
    const centerX = 10 + size / 2;
    const centerY = 20 + size / 2;
    const distance = Math.hypot(point.cx - centerX, point.cy - centerY);
    const outerRadius = radius + theme.S(1.2);
    assert.equal(point.cx, point.cy - 10);
    assert.ok(distance < size / 2, "badge center should overlap the avatar circle");
    assert.ok(distance + outerRadius > size / 2, "badge ring should cross the avatar edge");
  }
});

test("folder icons resolve canonical slugs instead of display labels", () => {
  const resolve = menuCanvasTestHelpers.resolveFolderIconSlug;
  assert.equal(resolve("public", "Utility"), "public");
  assert.equal(resolve("", "Utility"), "public");
  assert.equal(resolve("", "Group"), "manager");
  assert.equal(resolve("", "Bot"), "mybot");
  assert.equal(resolve("", "Special"), "hidden");
  assert.equal(resolve("game", "Game"), "game");
});
