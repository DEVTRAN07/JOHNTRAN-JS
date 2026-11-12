const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas } = require("canvas");
const converter = require("../core/stickerConvert");
const stickerCommand = require("../plugins/commands/stk");
const { test } = require("node:test");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("/stk tạo sticker vuông full-bleed, không ghép khung", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-sticker-clean-"));
  try {
    const canvas = createCanvas(240, 240);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const result = await converter.makeStickerFile(
      "https://example.test/source.png",
      dir,
      false,
      async () => ({ buffer: canvas.toBuffer("image/png") })
    );
    assert.ok([240, 360, 480].includes(result.width));
    assert.equal(result.width, result.height);
    assert.ok(result.size <= converter.SIZE_LIMIT);
    const extracted = path.join(dir, "first-frame.png");
    const extraction = spawnSync("ffmpeg", [
      "-y", "-i", result.path, "-frames:v", "1", "-update", "1", extracted
    ], { encoding: "utf8" });
    assert.equal(extraction.status, 0, extraction.stderr);
    const { Image } = require("canvas");
    const image = new Image();
    image.src = fs.readFileSync(extracted);
    const output = createCanvas(image.width, image.height);
    const context = output.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const pixelAt = (x, y) => Array.from(pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
    assert.ok(pixelAt(0, 0)[3] > 240, "full-bleed sticker should not have transparent frame corners");
    assert.ok(pixelAt(Math.floor(image.width / 2), Math.floor(image.height / 2))[1] > 170);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("/stk <URL> upload rồi gửi sticker, không gửi preview", { skip: !hasFfmpeg }, async () => {
  const canvas = createCanvas(120, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let uploadedFileWasValid = false;
  let sentSticker;
  const operations = [];

  await stickerCommand.run({
    api: {
      sendMessage: async (payload) => assert.ok(!payload.attachments),
      fetchZaloMedia: async () => ({ buffer: canvas.toBuffer("image/png") }),
      uploadStickerImage: async ({ filePath }) => {
        const output = fs.readFileSync(filePath);
        uploadedFileWasValid = output.subarray(0, 3).toString() === "GIF" || output.subarray(8, 12).toString() === "WEBP";
        operations.push("upload");
        return { normalUrl: "https://cdn.example.test/clean-sticker" };
      },
      sendCustomStickerUrl: async (payload) => { sentSticker = payload; operations.push("sticker"); }
    },
    event: { threadId: "test-thread", type: 0, data: {} },
    args: ["https://files.zdn.vn/source.png"]
  });

  assert.ok(uploadedFileWasValid);
  assert.deepEqual(operations, ["upload", "sticker"]);
  assert.equal(sentSticker.staticImgUrl, sentSticker.animationImgUrl);
});
