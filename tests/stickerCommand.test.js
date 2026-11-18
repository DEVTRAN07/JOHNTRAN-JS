"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const command = require("../plugins/commands/stk");
const decorations = require("../core/stickerDecorations");

test("/stk is registered as a decorations-only Tools command", () => {
  assert.equal(command.config.name, "stk");
  assert.equal(command.config.preferCommandOnBare, true);
  assert.match(command.config.usage, /số-ID/i);
  assert.doesNotMatch(command.config.usage, /1-5|khung/i);
});

test("/stk parses decoration IDs, media URLs, and random selection", () => {
  const defaults = command._test.parseArguments([]);
  assert.equal(defaults.url, null);
  assert.equal(defaults.decorationId, null);

  const selected = command._test.parseArguments(["shop-anime-in-love"]);
  assert.equal(selected.decorationId, "shop-anime-in-love");

  const numeric = command._test.parseArguments(["2"]);
  assert.equal(numeric.decorationId, "2");

  const linked = command._test.parseArguments([
    "https://cdn.example.test/photo.png",
    "shop-anime-in-love"
  ]);
  assert.equal(linked.url, "https://cdn.example.test/photo.png");
  assert.equal(linked.decorationId, "shop-anime-in-love");

  const random = command._test.parseArguments(["random"]);
  assert.equal(random.randomDecoration, true);
  assert.equal(random.decorationId, null);
});

test("/stk list and find parse catalog pagination and search terms", () => {
  assert.equal(command._test.parseArguments(["list", "3"]).page, 3);
  assert.equal(command._test.parseArguments(["decorations"]).list, true);
  assert.equal(command._test.parseArguments(["find", "anime", "love"]).find, "anime love");
});

test("/stk random selects from the local bundled catalog", async () => {
  const item = await command._test.resolveDecoration(command._test.parseArguments(["random"]));
  assert.ok(item);
  assert.ok(item.id);
  assert.ok(item.staticUrl);
  assert.equal(decorations.readManifest().items.some(row => row.id === item.id), true);
});


test("/stk numeric IDs resolve to 1-based positions in the full catalog", async () => {
  const items = decorations.readManifest().items;
  const first = await command._test.resolveDecoration(command._test.parseArguments(["1"]));
  const second = await command._test.resolveDecoration(command._test.parseArguments(["2"]));
  const last = await command._test.resolveDecoration(command._test.parseArguments([String(items.length)]));
  const invalid = await command._test.resolveDecoration(command._test.parseArguments([String(items.length + 1)]));

  assert.equal(first.id, items[0].id);
  assert.equal(second.id, items[1].id);
  assert.equal(last.id, items[items.length - 1].id);
  assert.equal(invalid, null);
});

test("/stk list and find display numeric IDs rather than internal slugs", async () => {
  const result = await decorations.getDecorations({ query: "anime", limit: 5 });
  const formatted = command._test.formatDecorationList(result, 1);

  for (const item of result.items) {
    const serial = decorations.readManifest().items.findIndex(row => row.id === item.id) + 1;
    assert.ok(formatted.includes("ID: " + serial));
    assert.ok(!formatted.includes("ID: " + item.id));
  }
});

test("/stk khung no longer displays the five removed custom frames", async () => {
  let sent = null;
  await command.run({
    api: { sendMessage: async payload => { sent = payload; } },
    event: { threadId: "test-thread", type: 1, data: {} },
    args: ["khung"]
  });
  assert.ok(sent);
  assert.match(sent.msg, /5 khung tự thiết kế cũ đã được gỡ/);
  assert.doesNotMatch(sent.msg, /Discord Classic|Discord Nitro|Midnight Discord|Discord Neon|Discord Hologram/);
});

test("/stk without reply or URL shows decoration-only usage", async () => {
  let sent = null;
  await command.run({
    api: { sendMessage: async payload => { sent = payload; } },
    event: { threadId: "test-thread", type: 1, data: {} },
    args: []
  });
  assert.ok(sent);
  assert.match(sent.msg, /Reply đúng tin ảnh\/GIF\/video/);
  assert.match(sent.msg, /stk list/);
  assert.doesNotMatch(sent.msg, /Discord Classic|Discord Nitro|Discord Hologram/);
});
