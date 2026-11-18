"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas } = require("canvas");
const service = require("../core/stkDiscordService");
const stickerService = require("../core/stickerService");

const FFMPEG = stickerService.resolveFfmpegBinary();
const ffmpegAvailable = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
const encoderProbe = ffmpegAvailable
  ? spawnSync(FFMPEG, ["-hide_banner", "-encoders"], { encoding: "utf8" })
  : null;
const webpAvailable = Boolean(encoderProbe) &&
  /\blibwebp\b/.test(String(encoderProbe.stdout || "") + String(encoderProbe.stderr || ""));

test("Discord STK compositor produces a transparent 288px WebP with a circular avatar", {
  skip: !ffmpegAvailable || !webpAvailable
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-discord-render-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sourcePath = path.join(dir, "avatar.png");
  const sourceCanvas = createCanvas(180, 120);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.fillStyle = "#ef4b42";
  sourceCtx.fillRect(0, 0, 180, 120);
  const sourceBuffer = sourceCanvas.toBuffer("image/png");
  fs.writeFileSync(sourcePath, sourceBuffer);

  const framePath = path.join(dir, "frame.png");
  const frameCanvas = createCanvas(288, 288);
  const frameCtx = frameCanvas.getContext("2d");
  frameCtx.clearRect(0, 0, 288, 288);
  assert.equal(frameCtx.getImageData(0, 0, 1, 1).data[3], 0,
    "fixture Discord frame starts with transparent corners");
  frameCtx.strokeStyle = "#7e57ff";
  frameCtx.lineWidth = 10;
  frameCtx.strokeRect(14, 14, 260, 260);
  fs.writeFileSync(framePath, frameCanvas.toBuffer("image/png"));

  const output = await service.createWebp(sourcePath, sourceBuffer, ".png", framePath);
  assert.equal(output.width, 288);
  assert.equal(output.height, 288);
  assert.equal(output.animated, false);
  assert.ok(output.size > 100);
  assert.ok(output.size <= service.MAX_OUTPUT_BYTES);
  assert.ok(fs.existsSync(output.path));

  const decoded = spawnSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-i", output.path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr || ""));
  const pixelAlpha = (x, y) => decoded.stdout[(y * 288 + x) * 4 + 3];
  assert.equal(pixelAlpha(0, 0), 0, "canvas corner remains transparent");
  assert.equal(pixelAlpha(144, 144), 255, "avatar centre remains opaque");
  assert.equal(pixelAlpha(24, 144), 0, "avatar left edge begins at x=24");
  assert.ok(pixelAlpha(36, 144) > 0, "avatar is placed at the Python offset");
  fs.rmSync(output.path, { force: true });
});


test("STK asset inventory resolves exact and alternate frame names", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-assets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = service.getDecoration(1);
  const second = service.getDecoration(2);
  const firstPath = path.join(dir, first.file);
  const secondPath = path.join(dir, "2_custom.webp");
  fs.writeFileSync(firstPath, Buffer.from("frame-1"));
  fs.writeFileSync(secondPath, Buffer.from("frame-2"));
  fs.writeFileSync(path.join(dir, "menu.jpg"), Buffer.from("menu"));

  assert.equal(service.resolveDecorationFile(1, dir), firstPath);
  assert.equal(service.resolveDecorationFile(2, dir), secondPath);
  assert.equal(service.resolveDecorationFile(3, dir), null);

  const status = service.getAssetStatus(dir);
  assert.equal(status.total, 200);
  assert.equal(status.available, 2);
  assert.equal(status.missingCount, 198);
  assert.equal(status.menu.exists, true);
  assert.equal(status.missing[0].id, 3);
});

test("STK asset inventory identifies a missing menu and an empty frame file", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-assets-empty-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = service.getDecoration(1);
  fs.writeFileSync(path.join(dir, first.file), Buffer.alloc(0));
  const status = service.getAssetStatus(dir);
  assert.equal(status.menu.exists, false);
  assert.equal(status.available, 0);
  assert.equal(status.missingCount, 200);
});


test("raw GitHub loader downloads one image lazily and reuses its local cache", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-raw-cache-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ZcAAAAASUVORK5CYII=",
    "base64"
  );
  const urls = [];
  const fetchImpl = async url => ({
    ok: true,
    status: 200,
    headers: { get: () => String(png.length) },
    arrayBuffer: async () => {
      urls.push(url);
      return png;
    }
  });

  const file = await service.ensureDecorationFile(200, {
    directory: dir,
    fetchImpl,
    ttlMs: 60_000
  });
  assert.equal(path.basename(file), "200_timekeepers_clock.png");
  assert.deepEqual(fs.readFileSync(file), png);
  assert.deepEqual(urls, [
    "https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main/200_timekeepers_clock.png"
  ]);

  const cached = await service.ensureDecorationFile(200, {
    directory: dir,
    fetchImpl,
    ttlMs: 60_000
  });
  assert.equal(cached, file);
  assert.equal(urls.length, 1, "second use must not download the frame again");
});

test("raw GitHub loader keeps a stale valid cache when the remote is unavailable", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-stale-cache-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, "menu.jpg");
  const cachedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  fs.writeFileSync(file, cachedJpeg);
  const fetched = await service.ensureRemoteAsset("menu.jpg", {
    directory: dir,
    rawBaseUrl: "https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main",
    fetchImpl: async () => { throw new Error("offline"); },
    ttlMs: 0,
    maxBytes: 1024
  });
  assert.equal(fetched, file);
  assert.deepEqual(fs.readFileSync(fetched), cachedJpeg);
});

test("raw GitHub loader rejects path traversal and invalid image payloads", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-stk-invalid-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    service.ensureRemoteAsset("../secret.png", { directory: dir }),
    /không hợp lệ/
  );
  await assert.rejects(
    service.ensureRemoteAsset("broken.png", {
      directory: dir,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "4" },
        arrayBuffer: async () => Buffer.from("nope")
      })
    }),
    /Không tải được broken\.png/
  );
});

test("STK metadata maps to the raw GitHub repository and has 200 frame URLs", () => {
  assert.equal(
    service.buildRawAssetUrl("menu.jpg"),
    "https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/main/menu.jpg"
  );
  assert.equal(service.catalog.items.length, 200);
  for (const item of service.catalog.items) {
    assert.ok(service.buildRawAssetUrl(item.file).endsWith("/" + item.file));
  }
});


test("STK FFmpeg selection uses the verified WebP-capable binary", async () => {
  const hasEncoder = await stickerService.hasWebpEncoder();
  if (hasEncoder) {
    const binary = stickerService.resolveFfmpegBinary();
    assert.ok(binary, "a verified FFmpeg binary should be selected");
    const probe = spawnSync(binary, ["-hide_banner", "-encoders"], {
      encoding: "utf8"
    });
    assert.equal(probe.status, 0, String(probe.stderr || ""));
    assert.match(String(probe.stdout || "") + String(probe.stderr || ""), /\blibwebp\b/);
  }
});
