const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas, Image } = require("canvas");
const converter = require("../core/stickerConvert");
const stickerFrames = require("../core/stickerFrames");
const stickerCommand = require("../plugins/commands/stk");
const { test } = require("node:test");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("/stk ghép khung mong vuốt rồng lên sticker", { skip: !hasFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-sticker-frame-"));
  try {
    const canvas = createCanvas(240, 240);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const result = await converter.makeStickerFile(
      "https://example.test/frame-source.png",
      dir,
      false,
      async () => ({ buffer: canvas.toBuffer("image/png") })
    );
    assert.ok([240, 360, 480].includes(result.width));
    assert.equal(result.width, result.height);
    assert.ok(result.size <= converter.SIZE_LIMIT, "sticker output should stay within Zalo's upload size limit");

    const extracted = path.join(dir, "first-frame.png");
    const extraction = spawnSync("ffmpeg", [
      "-y", "-i", result.path, "-frames:v", "1", "-update", "1", extracted
    ], { encoding: "utf8" });
    assert.equal(extraction.status, 0, extraction.stderr);

    const frame = new Image();
    frame.src = fs.readFileSync(extracted);
    const rendered = createCanvas(frame.width, frame.height);
    const renderedContext = rendered.getContext("2d");
    renderedContext.drawImage(frame, 0, 0);
    const pixels = renderedContext.getImageData(0, 0, frame.width, frame.height).data;
    const pixelAt = (x, y) => Array.from(
      pixels.slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4)
    );
    const scale = result.width / 480;
    const centerX = Math.floor(result.width / 2);
    const center = pixelAt(centerX, centerX);
    const insideCircleEdge = pixelAt(centerX, Math.round(65 * scale));
    const outsideCircleEdge = pixelAt(centerX, Math.round(50 * scale));
    assert.ok(center[1] > 170 && center[0] < 80 && center[2] < 80, "source media should be visible in the circular sticker");
    assert.ok(insideCircleEdge[1] > 170 && insideCircleEdge[0] < 80, "source media should reach the circular edge");
    assert.ok(!(outsideCircleEdge[1] > 170 && outsideCircleEdge[0] < 80), "source media should not bleed outside the circular edge");
    const frameOutsideCircle = pixelAt(centerX, Math.round(20 * scale));
    assert.ok(frameOutsideCircle[3] > 0, "frame artwork should surround the circular sticker");
    assert.equal(pixelAt(0, 0)[3], 0, "transparent space outside the frame should remain transparent");
    let pixelsChangedByFrame = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i]) > 20 || Math.abs(pixels[i + 1] - 255) > 20 ||
          Math.abs(pixels[i + 2]) > 20) {
        pixelsChangedByFrame++;
      }
    }
    assert.ok(pixelsChangedByFrame > 10000, "frame artwork should be visible in the output");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("/stk <URL> cũng đi qua xử lý ghép khung", { skip: !hasFfmpeg }, async () => {
  const canvas = createCanvas(120, 120);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let uploadedFileWasValid = false;
  let sentSticker;
  const operations = [];

  await stickerCommand.run({
    api: {
      // Không gửi ảnh xem trước (preview) — upload + gửi sticker trực tiếp.
      sendMessage: async (payload) => {
        // Không có payload nào gửi attachments (không preview).
        assert.ok(!payload.attachments, "không nên gửi attachments (preview đã bị xoá)");
      },
      fetchZaloMedia: async () => ({ buffer: canvas.toBuffer("image/png") }),
      uploadStickerImage: async ({ filePath }) => {
        const output = fs.readFileSync(filePath);
        uploadedFileWasValid = output.subarray(0, 3).toString() === "GIF" ||
          output.subarray(8, 12).toString() === "WEBP";
        operations.push("upload");
        return { normalUrl: "https://cdn.example.test/framed-sticker" };
      },
      sendCustomStickerUrl: async (payload) => {
        sentSticker = payload;
        operations.push("sticker");
      }
    },
    event: { threadId: "test-thread", type: 0, data: {} },
    args: ["3", "https://files.zdn.vn/source.png"]
  });

  assert.ok(uploadedFileWasValid, "URL input should be converted before upload");
  assert.deepEqual(operations, ["upload", "sticker"], "only upload + sticker, no preview");
  assert.equal(sentSticker.staticImgUrl, sentSticker.animationImgUrl);
});

test("/stk chooses frame by number and rejects unknown frame numbers", () => {
  assert.deepEqual(stickerCommand.parseFrameSelection(["4", "https://example.test/a.png"]), {
    frameId: 4,
    args: ["https://example.test/a.png"]
  });
  assert.deepEqual(stickerCommand.parseFrameSelection(["https://example.test/a.png"]), {
    frameId: 1,
    args: ["https://example.test/a.png"]
  });
  assert.equal(stickerCommand.parseFrameSelection(["6"]).invalid, true);

  const frames = stickerFrames.frameList();
  assert.equal(frames.length, 5);
  assert.deepEqual(frames.map(({ id }) => id), [1, 2, 3, 4, 5]);
  const assetPaths = frames.map(({ id }) => stickerFrames.resolveFramePath(id));
  assert.ok(assetPaths.every((assetPath) => fs.existsSync(assetPath)));
  assert.equal(new Set(assetPaths).size, frames.length, "each frame should use its own asset file");
  for (const assetPath of assetPaths) {
    assert.equal(fs.readFileSync(assetPath).subarray(1, 4).toString(), "PNG");
    const frameImage = new Image();
    frameImage.src = fs.readFileSync(assetPath);
    assert.ok([180, 480].includes(frameImage.width));
    assert.equal(frameImage.width, frameImage.height);

    const frameCanvas = createCanvas(frameImage.width, frameImage.height);
    const frameContext = frameCanvas.getContext("2d");
    frameContext.drawImage(frameImage, 0, 0);
    const framePixels = frameContext.getImageData(0, 0, frameImage.width, frameImage.height).data;
    const frameCenter = frameImage.width / 2;
    let visibleOuterPixels = 0;
    for (let y = 0; y < frameImage.height; y++) {
      for (let x = 0; x < frameImage.width; x++) {
        const distance = Math.hypot(x - frameCenter, y - frameCenter) / frameImage.width;
        if (distance > 0.4 && distance < 0.49 && framePixels[(y * frameImage.width + x) * 4 + 3] > 0) {
          visibleOuterPixels++;
        }
      }
    }
    assert.ok(
      framePixels[(frameCenter * frameImage.width + frameCenter) * 4 + 3] <= 8,
      "frame center should stay transparent"
    );
    assert.ok(visibleOuterPixels > 20, "frame artwork should surround the sticker");
  }
});
