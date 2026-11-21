"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const command = require("../plugins/commands/stk");
const service = require("../core/stkDiscordService");

test("/stk uses direct numeric selection and no longer exposes the dis subcommand", () => {
  assert.equal(command.config.name, "stk");
  assert.equal(command.config.version, "2.0.0");
  assert.equal(command.config.cooldowns, 0, "STK must not have a cross-command cooldown");
  assert.equal(command.config.backgroundExecution, true);
  assert.match(command.config.usage, /stk \[1-200\]/);
  assert.doesNotMatch(command.config.usage, /stk dis/);
  assert.doesNotMatch(command.config.usage, /list|find|random/i);
});

test("/stk with no arguments opens the menu; /stk dis is removed", () => {
  assert.deepEqual(command._test.parseArguments([]), {
    help: false, menu: true, decorationId: null, error: null
  });
  assert.deepEqual(command._test.parseArguments(["menu"]), {
    help: false, menu: true, decorationId: null, error: null
  });
  assert.match(command._test.parseArguments(["dis"]).error, /đã bỏ/);
  assert.match(command._test.parseArguments(["dis", "12"]).error, /đã bỏ/);
});

test("/stk N accepts exactly the 1-200 range", () => {
  assert.equal(command._test.parseArguments(["1"]).decorationId, 1);
  assert.equal(command._test.parseArguments(["200"]).decorationId, 200);
  assert.match(command._test.parseArguments(["0"]).error, /1 đến 200/);
  assert.match(command._test.parseArguments(["201"]).error, /1 đến 200/);
  assert.match(command._test.parseArguments(["abc"]).error, /Cú pháp/);
  assert.match(command._test.parseArguments(["12", "extra"]).error, /Cú pháp/);
});

test("the replacement Discord catalog contains all 200 ordered entries", () => {
  assert.equal(service.catalog.version, 1);
  assert.equal(service.catalog.total, 200);
  assert.equal(service.catalog.items.length, 200);
  assert.equal(service.getDecoration(1).file, "1_a_3c97a2d37f433a7913a1c7b7a735d000.png");
  assert.equal(service.getDecoration(11).file, "11_sakura.png");
  assert.equal(service.getDecoration(200).file, "200_timekeepers_clock.png");
  assert.equal(service.getDecoration(0), null);
  assert.equal(service.getDecoration(201), null);
});

test("the 200 frame catalog is stored under src/assets/stk rather than the runtime cache", () => {
  assert.ok(
    service.DECOR_DIR.replace(/\\\\/g, "/").endsWith("/src/assets/stk"),
    "frame assets must be resolved from the source asset folder"
  );
});

test("the renderer uses the Python layout dimensions and offset", () => {
  assert.equal(service.CANVAS_SIZE, 288);
  assert.equal(service.AVATAR_SIZE, 240);
  assert.equal(service.OFFSET, 24);
  const graph = service.buildFilterGraph(15);
  assert.match(graph, /scale=240:240/);
  assert.match(graph, /crop=240:240/);
  assert.match(graph, /overlay=24:24/);
  assert.match(graph, /scale=288:288/);
  assert.match(graph, /fps=15/);
});

test("animated source detection supports GIF, APNG, animated WebP and video", () => {
  const gif = Buffer.from("GIF89a" + "\\0".repeat(7) + ",frame1,frame2");
  assert.equal(service.isAnimatedBuffer(gif, ".gif"), true);

  const apng = Buffer.from("\\x89PNG\\r\\n\\x1a\\nIHDRacTL");
  assert.equal(service.isAnimatedBuffer(apng, ".png"), true);

  const webp = Buffer.from("RIFF0000WEBPANIMANMF");
  assert.equal(service.isAnimatedBuffer(webp, ".webp"), true);

  assert.equal(service.isAnimatedBuffer(Buffer.alloc(32), ".mp4"), true);
  assert.equal(service.isAnimatedBuffer(Buffer.alloc(32), ".jpg"), false);
});

test("quoted media extraction prioritizes the animated sticker URL", () => {
  const event = {
    data: {
      quote: {
        attach: JSON.stringify({
          webp: JSON.stringify({ url: "https://files.zdn.vn/sticker.webp" }),
          videoUrl: "https://files.zdn.vn/video.mp4",
          photoUrl: "https://files.zdn.vn/photo.jpg"
        })
      }
    }
  };
  assert.equal(command._test.getQuotedMediaUrl(event), "https://files.zdn.vn/sticker.webp");
});

test("expired-media detection is limited to 404/not-found errors", () => {
  assert.equal(command._test.isNotFoundError({ status: 404 }), true);
  assert.equal(command._test.isNotFoundError(new Error("HTTP 404 Not Found")), true);
  assert.equal(command._test.isNotFoundError(new Error("network timeout")), false);
});


test("/stk downloads the remote menu into cache and sends the cached file", async () => {
  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    }
  };
  const event = { threadId: "stk-test-thread", type: 1, data: {} };
  const originalEnsureMenu = service.ensureMenuFile;
  service.ensureMenuFile = async () => "/tmp/stk-discord-menu.jpg";
  try {
    await command.run({ api, event, args: [] });
  } finally {
    service.ensureMenuFile = originalEnsureMenu;
  }
  assert.equal(sent.length, 1, "the command sends only the final menu, without a progress message");
  assert.deepEqual(sent[0].attachments, ["/tmp/stk-discord-menu.jpg"]);
  assert.match(sent[0].msg, /AVATAR DECORATION/);
});




test("/stk dis is rejected with the replacement direct-number syntax", async () => {
  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    }
  };
  const event = { threadId: "stk-test-thread", type: 1, data: {} };
  await command.run({ api, event, args: ["dis"] });
  assert.equal(sent.length, 1);
  assert.match(sent[0].msg, /đã bỏ/);
  assert.match(sent[0].msg, /\/stk 12/);
});



test("/stk N returns immediately and sends the final result after background processing", async () => {
  const sent = [];
  const reactions = [];
  const originalProcess = service.processDiscordSticker;
  const originalEnsureFrame = service.ensureDecorationFile;
  let completed = false;
  service.ensureDecorationFile = async () => "/tmp/stk-local-frame.png";
  service.processDiscordSticker = async () => {
    await new Promise(resolve => setTimeout(resolve, 120));
    completed = true;
    return { size: 100 };
  };
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    },
    async addReaction(payload) {
      reactions.push(payload.icon);
      return { ok: true };
    }
  };
  const event = {
    threadId: "stk-background-test",
    type: 1,
    data: {
      uidFrom: "stk-user",
      dName: "Tester",
      msgId: "stk-background-message",
      cliMsgId: "stk-background-client",
      quote: { attach: JSON.stringify({ photoUrl: "https://files.zdn.vn/photo.jpg" }) }
    }
  };

  try {
    const started = Date.now();
    const result = await command.run({ api, event, args: ["12"] });
    const elapsed = Date.now() - started;
    assert.equal(result, true);
    assert.ok(elapsed < 900, "command dispatch must return in under one second without waiting for FFmpeg/upload");
    assert.equal(completed, false, "sticker job should still be processing in the background");

    for (let i = 0; i < 30 && (!completed || !reactions.includes("✅")); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(completed, true);
    assert.deepEqual(sent, [], "no transient acknowledgement or duplicate success text is sent");
    assert.ok(reactions.includes("✅"), "the original command gets a lightweight success reaction");
  } finally {
    service.processDiscordSticker = originalProcess;
    service.ensureDecorationFile = originalEnsureFrame;
  }
});


test("/stk re-sends a recent avatar UID cache without looking up avatar or reloading frame", async () => {
  const originalKey = service.createIdentityResultCacheKey;
  const originalRead = service.readStickerResultCache;
  const originalSendCached = service.sendCachedStickerForIdentity;
  const originalEnsureFrame = service.ensureDecorationFile;
  const originalProcess = service.processDiscordSticker;
  const cacheCalls = [];
  const reactions = [];
  let profileLookups = 0;
  let frameLookups = 0;

  service.createIdentityResultCacheKey = () => "test-avatar-cache-key";
  service.readStickerResultCache = key => key === "test-avatar-cache-key"
    ? { cdnUrl: "https://f123.zdn.vn/avatar-cached.png" }
    : null;
  service.sendCachedStickerForIdentity = async options => {
    cacheCalls.push(options);
    return { cached: true, response: { sent: true } };
  };
  service.ensureDecorationFile = async () => {
    frameLookups++;
    throw new Error("cache hit must skip frame download");
  };
  service.processDiscordSticker = async () => {
    throw new Error("cache hit must skip sticker rendering");
  };

  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    },
    async getUserInfo() {
      profileLookups++;
      return null;
    },
    async getAvatarUrlProfile() {
      profileLookups++;
      return null;
    },
    async addReaction(payload) {
      reactions.push(payload.icon);
      return { ok: true };
    }
  };
  const event = {
    threadId: "stk-uid-cache-thread",
    type: 1,
    data: {
      uidFrom: "cached-zalo-user",
      dName: "CacheUser",
      msgId: "stk-uid-cache-message",
      cliMsgId: "stk-uid-cache-client"
    }
  };

  try {
    const result = await command.run({ api, event, args: ["18"] });
    assert.equal(result, true);
    for (let i = 0; i < 40 && !reactions.includes("✅"); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(cacheCalls.length, 1);
    assert.equal(cacheCalls[0].identity, "cached-zalo-user");
    assert.equal(profileLookups, 0, "the profile API is skipped on a UID cache hit");
    assert.equal(frameLookups, 0, "the bundled local frame is skipped on a UID cache hit");
    assert.deepEqual(sent, [], "cache hits do not send transient or duplicate success messages");
    assert.ok(reactions.includes("✅"));
  } finally {
    service.createIdentityResultCacheKey = originalKey;
    service.readStickerResultCache = originalRead;
    service.sendCachedStickerForIdentity = originalSendCached;
    service.ensureDecorationFile = originalEnsureFrame;
    service.processDiscordSticker = originalProcess;
  }
});


test("/stk background failures include a traceable error ID and failing stage", async () => {
  const originalProcess = service.processDiscordSticker;
  const originalEnsureFrame = service.ensureDecorationFile;
  const sent = [];
  service.ensureDecorationFile = async () => "/tmp/stk-error-frame.png";
  service.processDiscordSticker = async () => {
    const error = new Error("synthetic renderer failure");
    error.stickerStage = "ffmpeg";
    throw error;
  };

  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    }
  };
  const event = {
    threadId: "stk-error-journal-test",
    type: 1,
    data: {
      uidFrom: "stk-error-user",
      dName: "Tester",
      msgId: "stk-error-message",
      cliMsgId: "stk-error-client",
      quote: {
        attach: JSON.stringify({
          photoUrl: "https://files.zdn.vn/stk-error-image.png"
        })
      }
    }
  };

  try {
    const result = await command.run({ api, event, args: ["12"] });
    assert.equal(result, true);

    for (let i = 0; i < 60 && !sent.some(item => /Mã lỗi: [A-F0-9]{8}/.test(item.msg || "")); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const failure = sent.find(item => /Mã lỗi: [A-F0-9]{8}/.test(item.msg || ""));
    assert.ok(failure, "the asynchronous STK failure must send a searchable error ID");
    assert.match(failure.msg, /Giai đoạn: ffmpeg/);
    assert.match(failure.msg, /synthetic renderer failure/);
  } finally {
    service.processDiscordSticker = originalProcess;
    service.ensureDecorationFile = originalEnsureFrame;
  }
});
