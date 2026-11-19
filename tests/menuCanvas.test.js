const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createCanvas, loadImage } = require("canvas");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { wrapApi } = require("../core/message");
const menuCommand = require("../plugins/commands/menu");
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

test("main menu resolves the canonical /bot slug to the bot category artwork", () => {
  const source = fs.readFileSync(require.resolve("../core/canvas/menu"), "utf8");
  assert.ok(source.includes("resolveFolderIconSlug(item.slug, item.name)"));
  assert.ok(source.includes('bot: "mybot"'));
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

test("menu no longer sends a progress placeholder before its Canvas card", () => {
  const source = fs.readFileSync(require.resolve("../plugins/commands/menu"), "utf8");
  assert.doesNotMatch(source, /Đang chuẩn bị menu chức năng/);
  assert.doesNotMatch(source, /MENU_ACK/);
});


test("menu tag and greeting are painted in the same multicolor Canvas attachment", async () => {
  const sourcePath = path.join(os.tmpdir(), "jt-menu-caption-source-" + process.pid + ".png");
  fs.writeFileSync(sourcePath, createCanvas(700, 460).toBuffer("image/png"));
  const sent = [];
  const drawn = [];
  const originalDraw = theme.drawMulticolorText;
  theme.drawMulticolorText = function(ctx, value, x, y, options) {
    drawn.push({ value: String(value), multicolor: options?.multicolor });
    return originalDraw.call(this, ctx, value, x, y, options);
  };

  const rawApi = {
    async sendMessage(payload, threadId, type) {
      const image = await loadImage(payload.attachments[0]);
      sent.push({
        payload, threadId, type,
        imageWidth: image.width,
        imageHeight: image.height,
        uploadedFileExists: fs.existsSync(payload.attachments[0])
      });
      return { message: null, attachment: [] };
    }
  };
  const api = wrapApi(rawApi, "menu-thread", 1, "menu");
  const caption = `@Wuang
🤖 Chào chủ nhân!
👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀`;
  const mention = { uid: "12345", pos: 0, len: "@Wuang".length };

  try {
    await menuCommand._sendMenuCardAndGreeting(
      api, sourcePath, caption, [mention], "menu-thread", 1
    );

    assert.equal(sent.length, 1, "card + tag + greeting must remain one Zalo message");
    assert.equal(sent[0].payload.msg, "", "Zalo must not render an unstyled photo description");
    assert.equal(sent[0].payload.mentions, undefined,
      "the @name painted into the image is visual and is not an interactive Zalo mention");
    assert.equal(sent[0].payload.attachments.length, 1);
    assert.equal(sent[0].imageWidth, 700);
    assert.ok(sent[0].imageHeight > 460, "the card PNG must contain a caption footer");
    assert.equal(sent[0].threadId, "menu-thread");
    assert.equal(sent[0].type, 1);
    assert.ok(sent[0].uploadedFileExists);
    assert.ok(drawn.some(item => item.value === "@Wuang" && item.multicolor));
    assert.ok(drawn.some(item => item.value.includes("Chào chủ nhân") && item.multicolor));
    assert.ok(drawn.some(item => item.value.includes("Rất vui") && item.multicolor));
  } finally {
    theme.drawMulticolorText = originalDraw;
    fs.rmSync(sourcePath, { force: true });
  }
});
