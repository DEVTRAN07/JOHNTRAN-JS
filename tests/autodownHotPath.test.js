"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const autodown = require("../plugins/commands/autodown");
const { ThreadType } = require("zalo-client");

function withConfig(config, run) {
  const previous = global.config;
  global.config = config;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete global.config;
      else global.config = previous;
    });
}

test("AutoDown skips storage reads for ordinary text messages", async () => {
  await withConfig({ prefix: "/", autodown: { enabled: true } }, async () => {
    let reads = 0;
    await autodown.handleEvent({
      api: {},
      event: {
        threadId: "autodown-hot-text",
        type: ThreadType.Group,
        data: { content: "xin chao ca nha" }
      },
      eventType: "message",
      isSelf: false,
      Threads: {
        getCachedData() { reads++; return null; },
        async getData() { reads++; return { data: { autodown: true } }; }
      }
    });
    assert.equal(reads, 0, "plain text must return before touching Thread storage");
  });
});

test("AutoDown skips storage reads for unsupported URLs", async () => {
  await withConfig({ prefix: "/", autodown: { enabled: true } }, async () => {
    let reads = 0;
    await autodown.handleEvent({
      api: {},
      event: {
        threadId: "autodown-hot-unsupported",
        type: ThreadType.Group,
        data: { content: "https://example.com/a-video" }
      },
      eventType: "message",
      isSelf: false,
      Threads: {
        getCachedData() { reads++; return null; },
        async getData() { reads++; return { data: { autodown: true } }; }
      }
    });
    assert.equal(reads, 0, "unsupported links must return before the group config lookup");
  });
});

test("AutoDown uses cached group settings before any async DB read", async () => {
  await withConfig({ prefix: "/", autodown: { enabled: true } }, async () => {
    let reads = 0;
    await autodown.handleEvent({
      api: {},
      event: {
        threadId: "autodown-hot-cache",
        type: ThreadType.Group,
        data: { content: "https://www.tiktok.com/@demo/video/123456" }
      },
      eventType: "message",
      isSelf: false,
      Threads: {
        getCachedData() { return { data: { autodown: false } }; },
        async getData() { reads++; return { data: { autodown: true } }; }
      }
    });
    assert.equal(reads, 0, "a hot cached OFF flag must stop AutoDown without awaiting storage");
  });
});
