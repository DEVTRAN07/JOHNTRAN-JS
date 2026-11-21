"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas } = require("canvas");
const service = require("../core/stickerService");
const native = require("../native");

const SOURCE_SHA = "804611c782965a2c3a8050e1135c9a91882a8ce7";
const CDN_GIF = "https://cdn.jsdelivr.net/gh/uhidontkno/DiscordAvatarDecorations@" + SOURCE_SHA + "/archive/test/gif/sample.gif";
const RAW_GIF = "https://raw.githubusercontent.com/uhidontkno/DiscordAvatarDecorations/" + SOURCE_SHA + "/archive/test/gif/sample.gif";

test("STK source URL validation rejects non-web and local addresses", () => {
  assert.equal(service.normalizeSourceUrl("file:///etc/passwd"), null);
  assert.equal(service.normalizeSourceUrl("javascript:alert(1)"), null);
  assert.equal(service.normalizeSourceUrl("http://localhost/a.png"), null);
  assert.equal(service.normalizeSourceUrl("https://cdn.example.test/a.png"), "https://cdn.example.test/a.png");
  assert.equal(service.isZaloMediaUrl("https://files.zdn.vn/a.png"), true);
  assert.equal(service.isZaloMediaUrl("https://evilzdn.vn/a.png"), false);
  assert.equal(service.isZaloMediaUrl("https://cdn.example.test/a.png"), false);
});

test("Discord asset URL guard accepts only pinned CDN and raw GitHub repository paths", () => {
  assert.equal(service.isAllowedDecorationAssetUrl(CDN_GIF), true);
  assert.equal(service.isAllowedDecorationAssetUrl(RAW_GIF), true);
  assert.equal(service.isAllowedDecorationAssetUrl("https://evil.example/sample.gif"), false);
  assert.equal(service.isAllowedDecorationAssetUrl("https://api.github.com/repos/uhidontkno/DiscordAvatarDecorations"), false);
  assert.equal(service.isAllowedDecorationAssetUrl("http://cdn.jsdelivr.net/gh/uhidontkno/DiscordAvatarDecorations@" + SOURCE_SHA + "/sample.gif"), false);
  assert.equal(service.isAllowedDecorationAssetUrl("https://cdn.jsdelivr.net/gh/other/repo@" + SOURCE_SHA + "/sample.gif"), false);
});

test("Discord decoration falls back from CDN failure to raw GitHub and caches the asset", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-decoration-assets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gif = Buffer.from("GIF89a" + "decoration");
  let requests = [];
  const decoration = {
    id: "archive-test-sample",
    name: "Sample",
    staticAvailable: true,
    staticUrl: "https://cdn.jsdelivr.net/gh/uhidontkno/DiscordAvatarDecorations@" + SOURCE_SHA + "/shop/test/sample.png",
    staticFallbackUrl: "https://raw.githubusercontent.com/uhidontkno/DiscordAvatarDecorations/" + SOURCE_SHA + "/shop/test/sample.png",
    animatedUrl: CDN_GIF,
    animatedFallbackUrl: RAW_GIF
  };
  const fetchImpl = async url => {
    requests.push(url);
    if (url === CDN_GIF) return { ok: false, status: 403, headers: { get: () => null } };
    assert.equal(url, RAW_GIF);
    return {
      ok: true,
      status: 200,
      headers: { get: name => name === "content-length" ? String(gif.length) : "image/gif" },
      async arrayBuffer() { return gif; }
    };
  };

  const first = await service.downloadDecorationOverlay(decoration, {
    animated: true,
    cacheDir: dir,
    fetchImpl
  });
  assert.equal(first.animated, true);
  assert.equal(first.cached, true);
  assert.equal(first.url, RAW_GIF);
  assert.ok(fs.existsSync(first.path));
  assert.deepEqual(requests, [CDN_GIF, RAW_GIF]);

  const second = await service.downloadDecorationOverlay(decoration, {
    animated: true,
    cacheDir: dir,
    fetchImpl: async () => { throw new Error("cache miss should not fetch"); }
  });
  assert.equal(second.path, first.path);
  assert.equal(requests.length, 2, "subsequent STK calls should reuse the cached image asset");
});

test("STK quote URL selection prioritizes animated sticker, then video and image", () => {
  assert.equal(
    service.pickMediaUrl({ webpUrl: "https://cdn.test/a.webp", video: "https://cdn.test/a.mp4", image: "https://cdn.test/a.png" }),
    "https://cdn.test/a.webp"
  );
  assert.equal(service.pickMediaUrl({ video: "https://cdn.test/a.mp4", image: "https://cdn.test/a.png" }), "https://cdn.test/a.mp4");
  assert.equal(service.pickMediaUrl({ image: "https://cdn.test/a.png" }), "https://cdn.test/a.png");
});

test("STK detects source type from magic bytes and content type", () => {
  assert.equal(service.sourceExtension("https://cdn.test/file?token=1", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])), ".png");
  assert.equal(service.sourceExtension("https://cdn.test/file.mp4", "", Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70])), ".mp4");
  assert.equal(service.sourceExtension("https://cdn.test/file.unknown", "", Buffer.alloc(80)), ".bin");
});

test("Zalo sticker URL and multipart upload helpers normalize the CDN address", () => {
  assert.equal(
    service.buildStickerUrl("https://cdn.zalo.test/file.gif?token=x", false),
    "https://cdn.zalo.test/file.gif?sticker.webp"
  );
  assert.equal(
    service.buildStickerUrl("https://cdn.zalo.test/file.gif", true),
    "https://cdn.zalo.test/file.webp?sticker.webp"
  );
  const multipart = service.buildMultipart("sample.webp", Buffer.from("abc"));
  assert.match(multipart.contentType, /^multipart\/form-data; boundary=/);
  assert.ok(multipart.body.includes(Buffer.from("chunkContent")));
  assert.ok(multipart.body.includes(Buffer.from("sample.webp")));
});

test("custom Zalo sticker methods register only once on the base API object", async t => {
  const handlers = new Map();
  const baseApi = {
    custom(name, handler) {
      handlers.set(name, handler);
      this[name] = props => handler({ ctx, utils, props });
    }
  };
  const ctx = { imei: "test-imei", loginInfo: { zpw_service_map_v3: { file: ["https://files.zalo.test/path/"] } } };
  const requests = [];
  const utils = {
    makeURL(url, params) { return url + "?stub=1"; },
    encodeAES(value) { return "encrypted-payload"; },
    async request(url, options) { requests.push({ url, options }); return { ok: true }; },
    async resolve() { return { normalUrl: "https://cdn.zalo.test/sticker.webp", cliMsgId: "sent-1" }; }
  };
  const wrappedApi = Object.create(baseApi);

  assert.strictEqual(service.registerStickerApi(wrappedApi), baseApi);
  service.registerStickerApi(wrappedApi);
  assert.deepEqual([...handlers.keys()].sort(), ["fetchZaloMedia", "sendCustomStickerUrl", "uploadStickerImage"]);
  assert.equal(typeof wrappedApi.uploadStickerImage, "function");
  assert.equal(typeof wrappedApi.sendCustomStickerUrl, "function");

  await assert.rejects(
    handlers.get("fetchZaloMedia")({ utils, props: { url: "https://cdn.example.test/image.png" } }),
    /CDN Zalo/
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-sticker-upload-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const stickerPath = path.join(tempDir, "test.webp");
  fs.writeFileSync(stickerPath, Buffer.alloc(128, 1));
  const uploaded = await wrappedApi.uploadStickerImage({ filePath: stickerPath, threadId: "group-1", threadType: 1 });
  assert.equal(uploaded.normalUrl, "https://cdn.zalo.test/sticker.webp");
  assert.match(requests[0].url, /group\/photo_original\/upload/);

  const sent = await wrappedApi.sendCustomStickerUrl({
    staticImgUrl: "https://cdn.zalo.test/sticker.webp?sticker.webp",
    animationImgUrl: "https://cdn.zalo.test/sticker.webp?sticker.webp",
    threadId: "group-1",
    threadType: 1,
    width: 512,
    height: 512
  });
  assert.equal(sent.cliMsgId, "sent-1");
  assert.match(requests[1].url, /group\/photo_url/);
});

test("FFmpeg fallback composes a transparent decoration overlay over a still image and respects the 512 KB cap", {
  skip: spawnSync(service.resolveFfmpegBinary(), ["-version"], { stdio: "ignore" }).status !== 0
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-sticker-compose-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.png");
  const overlay = path.join(dir, "decoration.png");
  const outputBase = path.join(dir, "sticker-");

  const canvas = createCanvas(160, 160);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 160, 160);
  gradient.addColorStop(0, "#ff542e");
  gradient.addColorStop(1, "#ffda63");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 160, 160);
  fs.writeFileSync(source, canvas.toBuffer("image/png"));

  const overlayCanvas = createCanvas(160, 160);
  const overlayCtx = overlayCanvas.getContext("2d");
  overlayCtx.strokeStyle = "#9b72ff";
  overlayCtx.lineWidth = 12;
  overlayCtx.strokeRect(8, 8, 144, 144);
  fs.writeFileSync(overlay, overlayCanvas.toBuffer("image/png"));

  const previousRustFlag = process.env.JT_RUST_STICKER_COMPOSITOR;
  process.env.JT_RUST_STICKER_COMPOSITOR = "0";
  let result;
  try {
    result = await service.convertMedia(source, overlay, outputBase);
  } finally {
    if (previousRustFlag === undefined) delete process.env.JT_RUST_STICKER_COMPOSITOR;
    else process.env.JT_RUST_STICKER_COMPOSITOR = previousRustFlag;
  }
  assert.equal(result.engine, "ffmpeg", "the documented rollback flag must keep FFmpeg available");
  assert.ok(result.size > 100);
  assert.ok(result.size <= service.MAX_STICKER_BYTES);
  assert.equal(result.width, result.height);
  assert.ok(["webp", "gif"].includes(result.format));
  assert.equal(result.shape, "circle");
  assert.equal(result.transparent, true);

  // Decode one frame to RGBA and prove the corners are transparent while the
  // centre remains opaque. This catches accidental square output or alpha loss.
  const decoded = spawnSync(service.resolveFfmpegBinary(), [
    "-hide_banner", "-loglevel", "error", "-i", result.path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr || ""));
  const pixelAlpha = (x, y) => decoded.stdout[(y * result.width + x) * 4 + 3];
  assert.equal(pixelAlpha(0, 0), 0, "top-left corner must be transparent");
  assert.equal(pixelAlpha(result.width - 1, 0), 0, "top-right corner must be transparent");
  assert.equal(pixelAlpha(0, result.height - 1), 0, "bottom-left corner must be transparent");
  assert.equal(pixelAlpha(result.width - 1, result.height - 1), 0, "bottom-right corner must be transparent");
  assert.equal(pixelAlpha(Math.floor(result.width / 2), Math.floor(result.height / 2)), 255,
    "circle centre must remain opaque");
});



test("multi-quality Rust compositor preserves the legacy quality output with one N-API call", {
  skip: !native.nativeAvailable.sticker
}, async () => {
  const addon = require("../native/sticker-rs/sticker_rs.node");
  assert.equal(typeof addon.composeStaticStickerProfiles, "function");

  const sourceCanvas = createCanvas(160, 160);
  const sourceContext = sourceCanvas.getContext("2d");
  const gradient = sourceContext.createLinearGradient(0, 0, 160, 160);
  gradient.addColorStop(0, "#ff542e");
  gradient.addColorStop(1, "#ffda63");
  sourceContext.fillStyle = gradient;
  sourceContext.fillRect(0, 0, 160, 160);

  const frameCanvas = createCanvas(160, 160);
  const frameContext = frameCanvas.getContext("2d");
  frameContext.strokeStyle = "#9b72ff";
  frameContext.lineWidth = 12;
  frameContext.strokeRect(8, 8, 144, 144);

  const source = sourceCanvas.toBuffer("image/png");
  const overlay = frameCanvas.toBuffer("image/png");
  const input = {
    source,
    overlay,
    size: 288,
    avatarSize: 240,
    offset: 24
  };

  const profiles = await addon.composeStaticStickerProfiles({
    ...input,
    qualities: [92, 88, 84, 80],
    maxOutputBytes: 1
  });
  assert.equal(profiles.quality, 80,
    "when no quality fits the cap, retain the smallest quality profile");
  assert.equal(profiles.format, "webp");
  assert.equal(profiles.width, 288);
  assert.equal(profiles.height, 288);
  assert.ok(profiles.size > 1);

  const legacy = await addon.composeStaticSticker({ ...input, quality: 80 });
  assert.deepEqual(
    Buffer.from(profiles.buffer),
    Buffer.from(legacy.buffer),
    "the combined Rust profile ladder must match the old single-quality output"
  );
});

test("Rust uses the asynchronous static-image STK path when the addon is available", {
  skip: !native.nativeAvailable.sticker ||
    process.env.JT_RUST_STICKER_COMPOSITOR === "0"
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jt-rust-sticker-compose-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source.png");
  const overlay = path.join(dir, "decoration.png");
  const outputBase = path.join(dir, "sticker-");

  const sourceCanvas = createCanvas(160, 160);
  const sourceContext = sourceCanvas.getContext("2d");
  const gradient = sourceContext.createLinearGradient(0, 0, 160, 160);
  gradient.addColorStop(0, "#ff542e");
  gradient.addColorStop(1, "#ffda63");
  sourceContext.fillStyle = gradient;
  sourceContext.fillRect(0, 0, 160, 160);
  fs.writeFileSync(source, sourceCanvas.toBuffer("image/png"));

  const frameCanvas = createCanvas(160, 160);
  const frameContext = frameCanvas.getContext("2d");
  frameContext.strokeStyle = "#9b72ff";
  frameContext.lineWidth = 12;
  frameContext.strokeRect(8, 8, 144, 144);
  fs.writeFileSync(overlay, frameCanvas.toBuffer("image/png"));

  const result = await service.convertMedia(source, overlay, outputBase);
  assert.equal(result.engine, "rust");
  assert.equal(result.format, "webp");
  assert.equal(result.animated, false);
  assert.ok(result.size > 100);
  assert.ok(result.size <= service.MAX_STICKER_BYTES);
  assert.equal(result.width, result.height);

  const decoded = spawnSync(service.resolveFfmpegBinary(), [
    "-hide_banner", "-loglevel", "error", "-i", result.path,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr || ""));
  const pixelAlpha = (x, y) => decoded.stdout[(y * result.width + x) * 4 + 3];
  assert.equal(pixelAlpha(0, 0), 0, "Rust output must keep the top-left corner transparent");
  assert.equal(pixelAlpha(result.width - 1, 0), 0, "Rust output must keep the top-right corner transparent");
  assert.equal(pixelAlpha(0, result.height - 1), 0, "Rust output must keep the bottom-left corner transparent");
  assert.equal(pixelAlpha(result.width - 1, result.height - 1), 0, "Rust output must keep the bottom-right corner transparent");
  assert.equal(pixelAlpha(Math.floor(result.width / 2), Math.floor(result.height / 2)), 255,
    "Rust output must keep the circle centre opaque");
});

test("Zalo request supports per-request timeout and retry overrides for STK media", async () => {
  const zaloHttp = require("../vendor/zalo-client/dist/cjs/core/http.cjs");
  let calls = 0;
  let observedSignal = null;
  const ctx = {
    cookie: { getCookieString: async () => "" },
    userAgent: "JOHNTRAN-STK-test",
    options: {
      retry: {
        timeoutMs: 60000,
        limit: 3,
        delayMs: 0,
        maxDelayMs: 0,
        methods: ["GET", "HEAD"]
      },
      polyfill: async (_url, options) => {
        calls += 1;
        observedSignal = options.signal;
        assert.equal(Object.prototype.hasOwnProperty.call(options, "timeoutMs"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(options, "retries"), false);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("per-request timeout")), {
            once: true
          });
        });
      }
    }
  };

  await assert.rejects(
    zaloHttp.request(ctx, "https://files.zdn.vn/sticker.png", {
      timeoutMs: 25,
      retries: 0
    }),
    /per-request timeout/
  );

  assert.equal(calls, 1, "retries=0 must prevent repeated 60-second media downloads");
  assert.ok(observedSignal?.aborted, "the per-request timeout must abort the HTTP request");
  assert.equal(ctx.options.retry.timeoutMs, 60000, "global Zalo timeout must not be changed");
  assert.equal(ctx.options.retry.limit, 3, "global retry policy must not be changed");
});
