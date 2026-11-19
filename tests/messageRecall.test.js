const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { wrapApi, sendStyledRawMessage, DEFAULT_AUTO_RECALL_MS } = require("../core/message");
const { sendMessageFactory } = require("../vendor/zalo-client/dist/cjs/api/sendMessage.cjs");
const { encodeAES, decodeAES } = require("../vendor/zalo-client/dist/cjs/core/crypto.cjs");
const { CookieJar } = require("tough-cookie");
const { TextStyle, ThreadType } = require("zalo-client");
const { isIntentionalRecall } = require("../core/runtime/intentionalRecall");
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
    for (const cliMsgId of [
      "text-client-id", "file-client-id", "voice-client-id",
      "video-client-id", "sticker-client-id", "card-client-id",
      "custom-sticker-client-id"
    ]) {
      assert.equal(isIntentionalRecall({
        threadId: "thread-id",
        data: { content: { cliMsgId } }
      }), true, "automatic TTL recall must be ignored by Anti-Recall");
    }
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

test("CommonJS image captions preserve randomized text colors", async () => {
  const secretKey = Buffer.alloc(16, 7).toString("base64");
  const requestParams = [];
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
        const data = encodeAES(secretKey, JSON.stringify({ error_code: 0, data: { msgId: "caption-image-id" } }));
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
    },
    async uploadAttachment() {
      return [{
        fileType: "image",
        photoId: "photo-id",
        width: 750,
        height: 520,
        normalUrl: "https://cdn.example/menu.png",
        hdUrl: "https://cdn.example/menu-hd.png",
        totalSize: 12000
      }];
    }
  };
  api.sendMessage = sendMessageFactory(ctx, api);
  const wrapped = wrapApi(api, "thread-id", 1, "menu");
  const caption = "@Nguyễn Văn A\n🤖 Chào chủ nhân!\n👉 Rất vui được đồng hành";

  await wrapped.sendMessage({
    msg: caption,
    attachments: ["/tmp/jt_menu_1_ab12.png"],
    mentions: [{ uid: "12345", pos: 0, len: "@Nguyễn Văn A".length }]
  }, "thread-id", 1);

  assert.equal(requestParams.length, 1, "a single PNG with caption should use one image request");
  assert.equal(requestParams[0].desc, caption);
  const imageMentions = JSON.parse(requestParams[0].mentionInfo);
  assert.equal(imageMentions.length, 1, "the image caption must preserve its real Zalo mention");
  assert.equal(imageMentions[0].uid, "12345");
  assert.equal(imageMentions[0].pos, 0);
  assert.equal(imageMentions[0].len, "@Nguyễn Văn A".length);
  const textProperties = JSON.parse(requestParams[0].textProperties);
  const appliedColors = textProperties.styles.map(style => style.st).filter(color => RANDOM_COLORS.has(color));
  assert.ok(appliedColors.length >= 5, "all caption words should receive randomized color styles");
  assert.ok(new Set(appliedColors).size >= 3, "caption should use several different colors");
  assert.ok(textProperties.styles.every(style => RANDOM_COLORS.has(style.st)),
    "the caption should not lose the randomized style metadata");
  const mentionEnd = "@Nguyễn Văn A".length;
  assert.ok(textProperties.styles.every(style =>
    style.start + style.len <= 0 || style.start >= mentionEnd),
  "caption colors must not overlap the Zalo mention span");
  assert.ok(textProperties.styles.some(style => style.start >= caption.indexOf("🤖")),
    "the greeting line beneath the tagged name must carry colors");
  assert.ok(textProperties.styles.some(style => style.start >= caption.indexOf("👉")),
    "the prompt line beneath the tagged name must carry colors");
});


test("PNG, JPG, JPEG and WEBP card captions all preserve randomized text colors and mentions", async () => {
  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    const secretKey = Buffer.alloc(16, 11).toString("base64");
    const requestParams = [];
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
          const data = encodeAES(secretKey, JSON.stringify({ error_code: 0, data: { msgId: "multi-format-card" } }));
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
      async uploadAttachment() {
        return [{
          fileType: "image",
          photoId: "card-photo-id",
          width: 750,
          height: 520,
          normalUrl: "https://cdn.example/card.png",
          hdUrl: "https://cdn.example/card-hd.png",
          totalSize: 12000
        }];
      }
    };
    rawApi.sendMessage = sendMessageFactory(ctx, rawApi);
    const wrapped = wrapApi(rawApi, "format-card-thread", ThreadType.Group, "card-format");
    const caption = `@Wuang
🤖 Chào chủ nhân!
👉 Card ${extension.toUpperCase()} này cũng phải có màu chữ ngẫu nhiên.`;
    const mention = { uid: "12345", pos: 0, len: "@Wuang".length };

    await wrapped.sendMessage({
      msg: caption,
      attachments: [`/tmp/jt_menu_1_ab12.${extension}`],
      mentions: [mention]
    }, "format-card-thread", ThreadType.Group);

    assert.equal(requestParams.length, 1, extension + " caption must share one request with its image");
    assert.equal(requestParams[0].desc, caption, extension + " caption must remain attached to the image");
    const mentionInfo = JSON.parse(requestParams[0].mentionInfo);
    assert.equal(mentionInfo[0].uid, "12345", extension + " caption must preserve its real tag");
    const textProperties = JSON.parse(requestParams[0].textProperties);
    const colors = textProperties.styles.filter(style => RANDOM_COLORS.has(style.st));
    assert.ok(colors.length >= 10, extension + " caption words must receive random colors");
    assert.ok(colors.every(style => style.start >= mention.len),
      extension + " color spans must not overlap the mention");
    assert.ok(colors.some(style => style.start >= caption.indexOf("🤖")),
      extension + " greeting line must be colored");
    assert.ok(colors.some(style => style.start >= caption.indexOf("👉")),
      extension + " prompt line must be colored");
  }
});



test("menu tag and random colors stay in the same Canvas image request in the real CommonJS SDK", async () => {
  const secretKey = Buffer.alloc(16, 9).toString("base64");
  const requestParams = [];
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
        const data = encodeAES(secretKey, JSON.stringify({
          error_code: 0,
          data: { msgId: `menu-message-${requestParams.length}` }
        }));
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
    async uploadAttachment() {
      return [{
        fileType: "image",
        photoId: "menu-photo-id",
        width: 750,
        height: 520,
        normalUrl: "https://cdn.example/menu.png",
        hdUrl: "https://cdn.example/menu-hd.png",
        totalSize: 12000
      }];
    }
  };
  rawApi.sendMessage = sendMessageFactory(ctx, rawApi);
  const wrapped = wrapApi(rawApi, "menu-thread", ThreadType.Group, "menu");
  const menuCommand = require("../plugins/commands/menu");
  const caption = `@Wuang
🤖 Chào chủ nhân!
👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀`;
  const mention = { uid: "12345", pos: 0, len: "@Wuang".length };

  await menuCommand._sendMenuCardAndGreeting(
    wrapped, "/tmp/jt_menu_1_ab12.png", caption, [mention], "menu-thread", ThreadType.Group
  );

  assert.equal(requestParams.length, 1, "one Canvas image with a caption must be one SDK request");
  const imageParams = requestParams[0];
  assert.equal(imageParams.desc, caption, "Zalo image description must contain the tagged greeting");
  const mentions = JSON.parse(imageParams.mentionInfo);
  assert.deepEqual(mentions, [{
    uid: "12345",
    pos: 0,
    len: "@Wuang".length,
    type: 0
  }], "the image caption must preserve a real group mention");

  const textProperties = JSON.parse(imageParams.textProperties);
  const colorStyles = textProperties.styles.filter(style => RANDOM_COLORS.has(style.st));
  assert.ok(colorStyles.length >= 10, "caption words after the mention must reach Zalo with random colors");
  assert.ok(colorStyles.every(style => style.start >= mention.len),
    "no random color span may overlap the Zalo-managed @Wuang mention");
  assert.ok(colorStyles.some(style => style.start >= caption.indexOf("🤖")),
    "the greeting line below the tag must be colored");
  assert.ok(colorStyles.some(style => style.start >= caption.indexOf("👉")),
    "the prompt line below the tag must be colored");
});
test("tagged menu captions color the greeting and prompt without overlapping the @mention", () => {
  const { randomize } = require("../core/styled");
  const caption = "@Nguyễn Văn A\\n🤖 Chào chủ nhân!\\n👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";
  const mentionLength = "@Nguyễn Văn A".length;
  const result = randomize({
    msg: caption,
    mentions: [{ uid: "12345", pos: 0, len: mentionLength }]
  }, { random: () => 0.5 });

  assert.equal(result.msg, caption, "coloring must not rewrite the caption text");
  assert.deepEqual(result.mentions, [{ uid: "12345", pos: 0, len: mentionLength }],
    "Zalo mention metadata must stay unchanged");

  const mentionEnd = mentionLength;
  assert.ok(result.styles.length >= 12, "greeting and prompt words should receive colors");
  assert.ok(result.styles.every(style => RANDOM_COLORS.has(style.st)),
    "generated caption styles should be color styles");
  assert.ok(result.styles.every(style =>
    style.start + style.len <= 0 || style.start >= mentionEnd),
    "no color style may overlap the @mention range");
  assert.ok(result.styles.some(style => style.start >= caption.indexOf("🤖")),
    "the owner greeting below the tag must be colored");
  assert.ok(result.styles.some(style => style.start >= caption.indexOf("👉")),
    "the prompt below the tag must be colored");
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
