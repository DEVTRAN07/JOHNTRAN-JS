const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { wrapApi, sendStyledRawMessage, DEFAULT_AUTO_RECALL_MS } = require("../core/message");
const { sendMessageFactory } = require("../vendor/zalo-client/dist/cjs/api/sendMessage.cjs");
const { encodeAES, decodeAES } = require("../vendor/zalo-client/dist/cjs/core/crypto.cjs");
const { CookieJar } = require("tough-cookie");
const { TextStyle, ThreadType } = require("zalo-client");
const RANDOM_COLORS = new Set([TextStyle.Red, TextStyle.Orange, TextStyle.Yellow, TextStyle.Green]);

test("CommonJS sendMessage returns the same cliMsgId it sent to Zalo", async () => {
  const secretKey = Buffer.alloc(16, 1).toString("base64");
  let requestParams;
  const ctx = {
    secretKey,
    API_VERSION: 1,
    API_TYPE: 30,
    imei: "test-device",
    settings: { features: { sharefile: { max_file: 10, max_size_share_file_v3: 50 } } },
    options: {
      polyfill: async (_url, options) => {
        requestParams = JSON.parse(decodeAES(secretKey, new URLSearchParams(options.body).get("params")));
        const data = encodeAES(secretKey, JSON.stringify({ error_code: 0, data: { msgId: "message-id" } }));
        return new Response(JSON.stringify({ error_code: 0, data }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    },
    cookie: new CookieJar(),
    userAgent: "test-agent"
  };
  const api = {
    zpwServiceMap: {
      chat: ["https://chat.example"],
      group: ["https://group.example"],
      file: ["https://file.example"]
    }
  };

  const sendMessage = sendMessageFactory(ctx, api);
  const response = await sendMessage({ msg: "test" }, "thread-id", 1);
  assert.equal(response.message.cliMsgId, String(requestParams.clientId));
});

test("bot messages are scheduled for recall after one minute", async () => {
  assert.equal(DEFAULT_AUTO_RECALL_MS, 60_000);

  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  const undone = [];
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  try {
    const api = {
      async sendMessage() {
        return {
          message: { msgId: 1, cliMsgId: "text-client-id" },
          attachment: [{ msgId: 2, cliMsgId: "file-client-id" }]
        };
      },
      async sendVoice() {
        return { msgId: 3, cliMsgId: "voice-client-id" };
      },
      async sendVideo() {
        return { msgId: 4, cliMsgId: "video-client-id" };
      },
      async sendSticker() {
        return { msgId: 5, cliMsgId: "sticker-client-id" };
      },
      async sendCard() {
        return { msgId: 6, cliMsgId: "card-client-id" };
      },
      async sendCustomStickerUrl() {
        return { msgId: 7, cliMsgId: "custom-sticker-client-id" };
      },
      async undo(payload, threadId, type) {
        undone.push({ payload, threadId, type });
      }
    };
    const wrapped = wrapApi(api, "thread-id", 1, "test");

    await wrapped.sendMessage({ msg: "hello" });
    await wrapped.sendVoice({ voiceUrl: "https://example.test/voice.m4a" });
    await wrapped.sendVideo({ videoUrl: "https://example.test/video.mp4" });
    await wrapped.sendSticker({ id: 1 }, "thread-id", 1);
    await wrapped.sendCard({ userId: "user-id" }, "thread-id", 1);
    await wrapped.sendCustomStickerUrl({
      staticImgUrl: "https://example.test/sticker.webp",
      threadId: "thread-id",
      threadType: 1
    });

    assert.equal(scheduled.length, 7);
    assert.ok(scheduled.every(({ delay }) => delay === 60_000));
    for (const { callback } of scheduled) await callback();
    assert.deepEqual(undone, [
      { payload: { msgId: 1, cliMsgId: "text-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 2, cliMsgId: "file-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 3, cliMsgId: "voice-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 4, cliMsgId: "video-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 5, cliMsgId: "sticker-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 6, cliMsgId: "card-client-id" }, threadId: "thread-id", type: 1 },
      { payload: { msgId: 7, cliMsgId: "custom-sticker-client-id" }, threadId: "thread-id", type: 1 }
    ]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});


test("auto-recalled messages skip cosmetic countdown reactions by default", async () => {
  const originalSetTimeout = global.setTimeout;
  const previousCountdown = process.env.JT_RECALL_COUNTDOWN_ENABLED;
  const scheduled = [];
  const reactions = [];
  const undone = [];
  delete process.env.JT_RECALL_COUNTDOWN_ENABLED;
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  try {
    const api = {
      async sendMessage() {
        return {
          message: { msgId: 31, cliMsgId: "clock-text" },
          attachment: [{ msgId: 32, cliMsgId: "clock-image" }]
        };
      },
      async addReaction(icon, destination) {
        reactions.push({ icon, destination });
      },
      async undo(message, threadId, type) {
        undone.push({ message, threadId, type });
      }
    };
    const wrapped = wrapApi(api, "thread-clock", 1, "test");
    await wrapped.sendMessage({ msg: "this message will be recalled", recallAfterMs: 2500 });
    await Promise.resolve();

    assert.equal(reactions.length, 0, "normal replies must not spend extra Zalo calls on clock decorations");
    assert.equal(scheduled.length, 2, "automatic recall remains scheduled for both text and attachment");
    for (const timer of scheduled) await timer.callback();
    assert.equal(undone.length, 2, "text and attachment are still recalled");
  } finally {
    global.setTimeout = originalSetTimeout;
    if (previousCountdown === undefined) delete process.env.JT_RECALL_COUNTDOWN_ENABLED;
    else process.env.JT_RECALL_COUNTDOWN_ENABLED = previousCountdown;
  }
});

test("clock countdown remains available when explicitly enabled", async () => {
  const originalSetTimeout = global.setTimeout;
  const previousCountdown = process.env.JT_RECALL_COUNTDOWN_ENABLED;
  const scheduled = [];
  const reactions = [];
  const undone = [];
  process.env.JT_RECALL_COUNTDOWN_ENABLED = "1";
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  try {
    const api = {
      async sendMessage() {
        return {
          message: { msgId: 41, cliMsgId: "enabled-clock-text" },
          attachment: [{ msgId: 42, cliMsgId: "enabled-clock-image" }]
        };
      },
      async addReaction(icon, destination) {
        reactions.push({ icon, destination });
      },
      async undo(message, threadId, type) {
        undone.push({ message, threadId, type });
      }
    };
    const wrapped = wrapApi(api, "thread-clock-enabled", 1, "test");
    await wrapped.sendMessage({ msg: "countdown enabled", recallAfterMs: 2500 });
    await Promise.resolve();

    assert.equal(reactions.length, 2, "text and attachment receive initial clock reactions");
    assert.ok(reactions.every(item => item.icon.rType === 0 && item.icon.source === 6));
    assert.deepEqual(reactions.map(item => item.destination.data), [
      { msgId: "41", cliMsgId: "enabled-clock-text" },
      { msgId: "42", cliMsgId: "enabled-clock-image" }
    ]);

    for (const timer of scheduled) await timer.callback();
    await Promise.resolve();
    assert.equal(reactions.length, 4, "stale clock ticks remain coalesced per message");
    assert.equal(undone.length, 2, "automatic recall still works with countdown enabled");
  } finally {
    global.setTimeout = originalSetTimeout;
    if (previousCountdown === undefined) delete process.env.JT_RECALL_COUNTDOWN_ENABLED;
    else process.env.JT_RECALL_COUNTDOWN_ENABLED = previousCountdown;
  }
});

test("legacy ttl becomes a local recall delay and is removed from the Zalo payload", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  const sent = [];
  const undone = [];
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  try {
    const api = {
      async sendMessage(payload) {
        sent.push(payload);
        return { message: { msgId: 21, cliMsgId: "legacy-ttl-id" }, attachment: [] };
      },
      async undo(payload, threadId, type) {
        undone.push({ payload, threadId, type });
      }
    };
    const wrapped = wrapApi(api, "thread-ttl", 1, "test");

    await wrapped.sendMessage({ msg: "expires locally", ttl: 2500 });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].msg, "expires locally");
    assert.equal("ttl" in sent[0], false);
    assert.ok(sent[0].styles.some(style => RANDOM_COLORS.has(style.st)));
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 2500);
    await scheduled[0].callback();
    assert.deepEqual(undone, [{
      payload: { msgId: 21, cliMsgId: "legacy-ttl-id" },
      threadId: "thread-ttl",
      type: 1
    }]);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("recallAfterMs is the new option for voice and is not forwarded to Zalo", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  const sent = [];
  global.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return { unref() {} };
  };

  try {
    const api = {
      async sendVoice(payload) {
        sent.push(payload);
        return { message: { msgId: 22, cliMsgId: "voice-recall-id" }, attachment: [] };
      },
      async undo() {}
    };
    const wrapped = wrapApi(api, "thread-voice", 1, "test");

    await wrapped.sendVoice({
      voiceUrl: "https://example.test/voice.m4a",
      recallAfterMs: 4000
    });

    assert.deepEqual(sent, [{ voiceUrl: "https://example.test/voice.m4a" }]);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 4000);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("zero recall delay disables local recall without sending a TTL field", async () => {
  const originalSetTimeout = global.setTimeout;
  let scheduledCount = 0;
  let sentPayload;
  global.setTimeout = (callback, delay) => {
    scheduledCount++;
    return { unref() {} };
  };

  try {
    const api = {
      async sendMessage(payload) {
        sentPayload = payload;
        return { message: { msgId: 23, cliMsgId: "no-recall-id" }, attachment: [] };
      },
      async undo() {}
    };
    const wrapped = wrapApi(api, "thread-no-recall", 1, "test");

    await wrapped.sendMessage({ msg: "keep this", recallAfterMs: 0 });

    assert.equal(sentPayload.msg, "keep this");
    assert.equal("ttl" in sentPayload, false);
    assert.ok(sentPayload.styles.some(style => RANDOM_COLORS.has(style.st)));
    assert.equal(scheduledCount, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("image captions become multicolor pixels in one composed Canvas attachment", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const { createCanvas, loadImage } = require("canvas");
  const theme = require("../core/canvas/theme");
  const { composeImageCaption, cleanupComposedCaption } = require("../core/canvas/attachmentCaption");
  const originalPath = path.join(os.tmpdir(), "jt-caption-source-" + process.pid + ".png");
  const originalImage = createCanvas(720, 420);
  const originalCtx = originalImage.getContext("2d");
  originalCtx.fillStyle = "#20354d";
  originalCtx.fillRect(0, 0, 720, 420);
  fs.writeFileSync(originalPath, originalImage.toBuffer("image/png"));

  const caption = "@Wuang\n🤖 Chào chủ nhân!\n👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
  const drawnLines = [];
  const originalDraw = theme.drawMulticolorText;
  theme.drawMulticolorText = function(ctx, value, x, y, options) {
    drawnLines.push({ value: String(value), multicolor: options?.multicolor });
    return originalDraw.call(this, ctx, value, x, y, options);
  };

  let composed;
  try {
    composed = await composeImageCaption({
      msg: caption,
      attachments: [originalPath],
      mentions: [{ uid: "12345", pos: 0, len: "@Wuang".length }]
    });
  } finally {
    theme.drawMulticolorText = originalDraw;
  }

  try {
    assert.equal(composed.composed, true);
    assert.equal(composed.payload.msg, "", "Zalo must not receive an unstyled description below the image");
    assert.equal(composed.payload.mentions, undefined,
      "an @name painted into the Canvas is visual, not an interactive Zalo mention");
    assert.equal(composed.payload.attachments.length, 1);
    const image = await loadImage(composed.payload.attachments[0]);
    assert.equal(image.width, 720);
    assert.ok(image.height > 420, "the generated attachment must contain a visible caption footer");
    assert.ok(drawnLines.some(line => line.value === "@Wuang" && line.multicolor === true));
    assert.ok(drawnLines.some(line => line.value.includes("Chào chủ nhân") && line.multicolor === true));
    assert.ok(drawnLines.some(line => line.value.includes("Rất vui") && line.multicolor === true));
  } finally {
    await cleanupComposedCaption(composed?.tempFile);
    fs.rmSync(originalPath, { force: true });
  }
});

test("shared send wrapper uploads one composed image instead of a separate caption bubble", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const { createCanvas, loadImage } = require("canvas");
  const sourcePath = path.join(os.tmpdir(), "jt-wrapper-caption-" + process.pid + ".png");
  fs.writeFileSync(sourcePath, createCanvas(640, 360).toBuffer("image/png"));
  const sent = [];
  const rawApi = {
    async sendMessage(payload, threadId, type) {
      const image = await loadImage(payload.attachments[0]);
      sent.push({
        payload,
        threadId,
        type,
        width: image.width,
        height: image.height,
        fileExistsDuringUpload: fs.existsSync(payload.attachments[0])
      });
      return { message: null, attachment: [] };
    }
  };
  const wrapped = wrapApi(rawApi, "caption-thread", ThreadType.Group, "caption-test");
  const caption = "@Member\n✨ Nội dung này phải có nhiều màu\nKhông được tách thành tin nhắn thứ hai.";

  try {
    await wrapped.sendMessage({ msg: caption, attachments: [sourcePath] });
    assert.equal(sent.length, 1, "one card with caption must be sent in one API call");
    assert.equal(sent[0].payload.msg, "");
    assert.equal(sent[0].payload.mentions, undefined);
    assert.equal(sent[0].payload.attachments.length, 1);
    assert.ok(sent[0].fileExistsDuringUpload);
    assert.equal(sent[0].width, 640);
    assert.ok(sent[0].height > 360);
    assert.equal(sent[0].threadId, "caption-thread");
    assert.equal(sent[0].type, ThreadType.Group);
    assert.equal(fs.existsSync(sent[0].payload.attachments[0]), false,
      "the temporary composed PNG is removed after upload finishes");
  } finally {
    fs.rmSync(sourcePath, { force: true });
  }
});

test("real CommonJS SDK receives the composed colored card, not an unstyled description", async () => {
  const os = require("node:os");
  const path = require("node:path");
  const { createCanvas, loadImage } = require("canvas");
  const sourcePath = path.join(os.tmpdir(), "jt-sdk-caption-" + process.pid + ".png");
  fs.writeFileSync(sourcePath, createCanvas(720, 400).toBuffer("image/png"));

  const secretKey = Buffer.alloc(16, 13).toString("base64");
  const requestParams = [];
  const uploaded = [];
  const ctx = {
    secretKey,
    API_VERSION: 1,
    API_TYPE: 30,
    imei: "test-device",
    settings: { features: { sharefile: { max_file: 10, max_size_share_file_v3: 50 } } },
    options: {
      polyfill: async (url, options) => {
        const encrypted = new URL(url).searchParams.get("params") ||
          new URLSearchParams(options?.body || "").get("params");
        requestParams.push(JSON.parse(decodeAES(secretKey, encrypted)));
        const data = encodeAES(secretKey, JSON.stringify({ error_code: 0, data: { msgId: "composed-caption-id" } }));
        return new Response(JSON.stringify({ error_code: 0, data }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    },
    cookie: new CookieJar(),
    userAgent: "test-agent"
  };
  const rawApi = {
    zpwServiceMap: {
      chat: ["https://chat.example"],
      group: ["https://group.example"],
      file: ["https://file.example"]
    },
    async uploadAttachment(attachments) {
      const image = await loadImage(attachments[0]);
      uploaded.push({ path: attachments[0], width: image.width, height: image.height });
      return [{
        fileType: "image",
        photoId: "composed-photo-id",
        width: image.width,
        height: image.height,
        normalUrl: "https://cdn.example/composed.png",
        hdUrl: "https://cdn.example/composed-hd.png",
        totalSize: fs.statSync(attachments[0]).size
      }];
    },
    async undo() {}
  };
  rawApi.sendMessage = sendMessageFactory(ctx, rawApi);
  const wrapped = wrapApi(rawApi, "sdk-caption-thread", ThreadType.Group, "sdk-caption-test");

  try {
    await wrapped.sendMessage({
      msg: "@Wuang\\n🤖 Chào chủ nhân!\\n👉 Dòng này phải có màu trong chính ảnh.",
      attachments: [sourcePath],
      mentions: [{ uid: "12345", pos: 0, len: "@Wuang".length }],
      recallAfterMs: 0
    });

    assert.equal(uploaded.length, 1, "only the composed card is uploaded");
    assert.equal(uploaded[0].width, 720);
    assert.ok(uploaded[0].height > 400, "uploaded image contains the appended footer");
    assert.equal(fs.existsSync(uploaded[0].path), false, "temporary file is cleaned after upload");
    assert.equal(requestParams.length, 1, "the image and footer are still one SDK message");
    assert.equal(requestParams[0].desc, "", "Zalo receives no unstyled photo description");
    assert.equal(requestParams[0].mentionInfo, undefined,
      "a decorative @name inside image pixels is not sent as an interactive mention");
    assert.equal(requestParams[0].textProperties, undefined,
      "caption colors are rendered into the uploaded PNG, not delegated to ignored image styles");
  } finally {
    fs.rmSync(sourcePath, { force: true });
  }
});

test("normal text messages continue to receive randomized styles without Canvas composition", async () => {
  const sent = [];
  const rawApi = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: null, attachment: [] };
    }
  };
  const wrapped = wrapApi(rawApi, "plain-thread", ThreadType.Group, "plain-test");
  await wrapped.sendMessage({ msg: "Tin nhắn chữ thường vẫn phải có màu ngẫu nhiên" });

  assert.equal(sent.length, 1);
  assert.ok(sent[0].styles.some(style => RANDOM_COLORS.has(style.st)));
  assert.equal(sent[0].attachments, undefined);
});

test("raw game sends keep random colors while preserving mentions and attachments", async () => {
  const sent = [];
  const rawApi = {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return { message: { msgId: 41, cliMsgId: "raw-styled-game" }, attachment: [] };
    }
  };
  const payload = {
    msg: "🎲 Trận đấu đã sẵn sàng mời người chơi",
    mentions: [{ uid: "12345", pos: 4, len: 6 }],
    attachments: ["/tmp/game-card.png"],
    recallAfterMs: 0,
    ttlKind: "card"
  };

  const response = await sendStyledRawMessage(rawApi, payload, "game-thread", 1);
  assert.equal(response.message.cliMsgId, "raw-styled-game");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].threadId, "game-thread");
  assert.equal(sent[0].type, 1);
  assert.equal(sent[0].payload.msg, payload.msg);
  assert.deepEqual(sent[0].payload.mentions, payload.mentions);
  assert.deepEqual(sent[0].payload.attachments, payload.attachments);
  assert.equal(sent[0].payload.recallAfterMs, 0);
  const colors = sent[0].payload.styles.map(style => style.st);
  assert.ok(colors.length >= 6, "each caption token should receive a color");
  assert.ok(colors.every(color => RANDOM_COLORS.has(color)));
  assert.ok(new Set(colors).size > 1, "raw game captions should use multiple colors");
});

test("Caro, Sâm and Tiến Lên route deliberate raw sends through shared text styling", () => {
  for (const file of ["caro.js", "sam.js", "tlmn.js"]) {
    const source = fs.readFileSync(require.resolve("../plugins/commands/" + file), "utf8");
    assert.match(source, /sendStyledRawMessage/,
      file + " must use the shared styler for raw SDK sends");
    assert.doesNotMatch(source, /\b(?:rawApi|sender|rawApiInstance)\.sendMessage\s*\(/,
      file + " must not bypass random text styling");
    assert.doesNotMatch(source, /getRawApi\(api\)\.sendMessage\s*\(/,
      file + " must not send directly from getRawApi()");
  }
});
