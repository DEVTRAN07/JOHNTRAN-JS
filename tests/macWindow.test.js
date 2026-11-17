const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createCanvas, loadImage } = require("canvas");
const { test } = require("node:test");
const { withMacWindow } = require("../core/canvas/macWindow");
const theme = require("../core/canvas/theme");

test("card gets a macOS title bar with traffic-light controls", () => {
  const content = createCanvas(750, 300);
  const ctx = content.getContext("2d");
  ctx.fillStyle = "#123456";
  ctx.fillRect(0, 0, content.width, content.height);

  const card = withMacWindow(content, "Preview");
  const output = card.getContext("2d");
  const toolbarHeight = 44;
  const contentInset = 12;

  assert.equal(card.width, 750);
  assert.equal(card.height, 358);
  assert.deepEqual(
    Array.from(output.getImageData(21, 22, 1, 1).data).slice(0, 3),
    [255, 95, 87]
  );
  assert.deepEqual(
    Array.from(output.getImageData(41, 22, 1, 1).data).slice(0, 3),
    [254, 188, 46]
  );
  assert.deepEqual(
    Array.from(output.getImageData(61, 22, 1, 1).data).slice(0, 3),
    [40, 200, 64]
  );
  assert.deepEqual(
    Array.from(output.getImageData(300, toolbarHeight + contentInset + 19, 1, 1).data).slice(0, 3),
    [18, 52, 86]
  );
  assert.deepEqual(
    Array.from(output.getImageData(375, toolbarHeight + 10, 1, 1).data).slice(0, 3),
    [8, 9, 13]
  );
});

test("all shared Canvas save prefixes produce raw PNG images without Mac window chrome", async () => {
  const content = createCanvas(750, 300);
  const ctx = content.getContext("2d");
  ctx.fillStyle = "#123456";
  ctx.fillRect(0, 0, content.width, content.height);

  const prefixes = [
    "menu", "menu_folder", "music_grid", "music_now", "topchat",
    "status", "profile_card", "generic_card", "bot_groups",
    "caro", "tlmn", "sam", "card"
  ];

  for (const prefix of prefixes) {
    const filePath = theme.save(content, prefix);
    try {
      const image = await loadImage(fs.readFileSync(filePath));
      assert.equal(image.width, 750, prefix + " must preserve the canvas width");
      assert.equal(image.height, 300, prefix + " must not add a desktop toolbar");
      const output = createCanvas(image.width, image.height);
      const outputContext = output.getContext("2d");
      outputContext.drawImage(image, 0, 0);
      assert.deepEqual(
        Array.from(outputContext.getImageData(375, 22, 1, 1).data).slice(0, 3),
        [18, 52, 86],
        prefix + " must save the original canvas pixels"
      );
      assert.notDeepEqual(
        Array.from(outputContext.getImageData(21, 22, 1, 1).data).slice(0, 3),
        [255, 95, 87],
        prefix + " must not include the macOS close dot"
      );
    } finally {
      fs.unlinkSync(filePath);
    }
  }
});
