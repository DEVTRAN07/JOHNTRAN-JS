"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].attachments, ["/tmp/stk-discord-menu.jpg"]);
  assert.match(sent[0].msg, /AVATAR DECORATION/);
});




test("/stk dis reports a raw GitHub error when the menu cannot be downloaded", async () => {
  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    }
  };
  const event = { threadId: "stk-test-thread", type: 1, data: {} };
  const originalEnsureMenu = service.ensureMenuFile;
  service.ensureMenuFile = async () => { throw new Error("network offline"); };
  try {
    await command.run({ api, event, args: ["dis"] });
  } finally {
    service.ensureMenuFile = originalEnsureMenu;
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].msg, /raw GitHub/);
  assert.match(sent[0].msg, /network offline/);
});



test("/stk N returns immediately and sends the final result after background processing", async () => {
  const sent = [];
  const reactions = [];
  const originalProcess = service.processDiscordSticker;
  let completed = false;
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
    assert.ok(elapsed < 100, "command dispatch must not wait for FFmpeg/upload");
    assert.equal(completed, false, "sticker job should still be processing in the background");

    for (let i = 0; i < 30 && !completed; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(completed, true);
    assert.ok(sent.some(item => /Đã nhận yêu cầu tạo sticker/.test(item.msg || "")));
    assert.ok(sent.some(item => /SUCCESS/.test(item.msg || "")));
  } finally {
    service.processDiscordSticker = originalProcess;
  }
});
