const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadImage } = require("canvas");
const { test } = require("node:test");
const theme = require("../core/canvas/theme");
const { renderMenuGrid } = require("../core/canvas/menu");

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
