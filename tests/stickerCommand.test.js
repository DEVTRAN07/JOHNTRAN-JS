"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/stk");
const service = require("../core/stkDiscordService");

test("/stk defaults to the Discord menu and keeps the Python-style dis subcommand", () => {
  assert.equal(command.config.name, "stk");
  assert.equal(command.config.version, "2.0.0");
  assert.match(command.config.usage, /stk \(menu\)/);
  assert.match(command.config.usage, /stk dis/);
  assert.doesNotMatch(command.config.usage, /list|find|random/i);
});

test("/stk and /stk dis without an index open the menu", () => {
  assert.deepEqual(command._test.parseArguments([]), {
    help: false, menu: true, decorationId: null, error: null
  });
  assert.deepEqual(command._test.parseArguments([""]), {
    help: false, menu: true, decorationId: null, error: null
  });
  assert.deepEqual(command._test.parseArguments(["dis"]), {
    help: false, menu: true, decorationId: null, error: null
  });
  assert.equal(command._test.parseArguments(["dis", "menu"]).menu, true);
  assert.equal(command._test.parseArguments(["dis", "help"]).menu, true);
});

test("/stk dis accepts exactly the 1-200 index range", () => {
  assert.equal(command._test.parseArguments(["dis", "1"]).decorationId, 1);
  assert.equal(command._test.parseArguments(["dis", "200"]).decorationId, 200);
  assert.match(command._test.parseArguments(["dis", "0"]).error, /1 đến 200/);
  assert.match(command._test.parseArguments(["dis", "201"]).error, /1 đến 200/);
  assert.match(command._test.parseArguments(["dis", "abc"]).error, /không hợp lệ/);
  assert.equal(command._test.parseArguments(["list"]).help, true);
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


test("/stk dis downloads the remote menu into cache and sends the cached file", async () => {
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
    await command.run({ api, event, args: ["dis"] });
  } finally {
    service.ensureMenuFile = originalEnsureMenu;
  }
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].attachments, ["/tmp/stk-discord-menu.jpg"]);
  assert.match(sent[0].msg, /AVATAR DECORATION/);
});


test("/stk with no arguments sends the remote menu image", async () => {
  const sent = [];
  const api = {
    async sendMessage(message) {
      sent.push(message);
      return { ok: true };
    }
  };
  const event = { threadId: "stk-bare-test-thread", type: 1, data: {} };
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


