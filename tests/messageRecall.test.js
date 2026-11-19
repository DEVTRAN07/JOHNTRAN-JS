const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { wrapApi, sendStyledRawMessage, DEFAULT_AUTO_RECALL_MS } = require("../core/message");
const { sendMessageFactory } = require("../vendor/zalo-client/dist/cjs/api/sendMessage.cjs");
const { encodeAES, decodeAES } = require("../vendor/zalo-client/dist/cjs/core/crypto.cjs");
const { CookieJar } = require("tough-cookie");
const { TextStyle } = require("zalo-client");
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


test("every auto-recalled message gets a clock-face reaction countdown", async () => {
  const originalSetTimeout = global.setTimeout;
  const scheduled = [];
  const reactions = [];
  const undone = [];
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

    assert.equal(reactions.length, 2, "text and attachment both receive the initial clock reaction");
    assert.ok(reactions.every(item => item.icon.rType === 0 && item.icon.source === 6));
    assert.deepEqual(reactions.map(item => item.destination.data), [
      { msgId: "31", cliMsgId: "clock-text" },
      { msgId: "32", cliMsgId: "clock-image" }
    ]);

    for (const timer of scheduled) await timer.callback();
    await Promise.resolve();
    assert.equal(reactions.length, 4, "stale clock ticks are coalesced per message instead of sent in a burst");
    assert.equal(undone.length, 2, "text and attachment are both recalled");
  } finally {
    global.setTimeout = originalSetTimeout;
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
  const textProperties = JSON.parse(requestParams[0].textProperties);
  const appliedColors = textProperties.styles.map(style => style.st).filter(color => RANDOM_COLORS.has(color));
  assert.ok(appliedColors.length >= 5, "all caption words should receive randomized color styles");
  assert.ok(new Set(appliedColors).size >= 3, "caption should use several different colors");
  assert.ok(textProperties.styles.every(style => RANDOM_COLORS.has(style.st)),
    "the caption should not lose the randomized style metadata");
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
    assert.doesNotMatch(source, /\\b(?:rawApi|sender|rawApiInstance)\\.sendMessage\\s*\\(/,
      file + " must not bypass random text styling");
    assert.doesNotMatch(source, /getRawApi\\(api\\)\\.sendMessage\\s*\\(/,
      file + " must not send directly from getRawApi()");
  }
});
