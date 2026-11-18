"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCanvas } = require("canvas");
const service = require("../core/stickerService");

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

test("FFmpeg composes a transparent decoration overlay over a still image and respects the 512 KB cap", {
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

  const result = await service.convertMedia(source, overlay, outputBase);
  assert.ok(result.size > 100);
  assert.ok(result.size <= service.MAX_STICKER_BYTES);
  assert.equal(result.width, result.height);
  assert.ok(["webp", "gif"].includes(result.format));
});
