"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/stk");
const frames = require("../core/stickerFrames");

test("/stk is an executable Tools command and owns its bare invocation", () => {
  assert.equal(command.config.name, "stk");
  assert.equal(command.config.preferCommandOnBare, true);
  assert.match(command.config.usage, /reply media/i);
});

test("/stk keeps local frame numbers and accepts a remote decoration ID", () => {
  const defaults = command._test.parseArguments([]);
  assert.equal(defaults.frameId, 1);
  assert.equal(defaults.url, null);

  const chosen = command._test.parseArguments(["3"]);
  assert.equal(chosen.frameId, 3);
  assert.equal(chosen.decorationId, null);

  const linked = command._test.parseArguments(["https://cdn.example.test/photo.png", "5"]);
  assert.equal(linked.url, "https://cdn.example.test/photo.png");
  assert.equal(linked.frameId, 5);

  const selected = command._test.parseArguments(["shop-anime-in-love"]);
  assert.equal(selected.decorationId, "shop-anime-in-love");
});

test("/stk list and find parse catalog pagination and search terms", () => {
  assert.deepEqual(command._test.parseArguments(["list", "3"]).page, 3);
  assert.equal(command._test.parseArguments(["decorations"]).list, true);
  assert.equal(command._test.parseArguments(["find", "anime", "love"]).find, "anime love");
});

test("/stk random selects from the cached decoration catalog", () => {
  const random = command._test.parseArguments(["random"]);
  assert.equal(random.randomDecoration, true);
  assert.equal(random.decorationId, null);
});

test("/stk khung lists all five built-in Discord presets without requiring media", async () => {
  let sent = null;
  await command.run({
    api: { sendMessage: async payload => { sent = payload; } },
    event: { threadId: "test-thread", type: 1 },
    args: ["khung"]
  });
  assert.ok(sent);
  for (const item of frames.frameList()) {
    assert.ok(sent.msg.includes(item.name));
  }
  assert.ok(sent.msg.includes("/stk list"));
});

test("/stk without reply or URL shows direct usage instead of throwing", async () => {
  let sent = null;
  await command.run({
    api: { sendMessage: async payload => { sent = payload; } },
    event: { threadId: "test-thread", type: 1, data: {} },
    args: []
  });
  assert.ok(sent);
  assert.match(sent.msg, /Reply đúng tin ảnh\/GIF\/video/);
});
