"use strict";

const { test, after } = require("node:test");
const workerPool = require("../core/workerPool");

after(async () => { await workerPool.shutdown(); });
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

// This suite measures command orchestration and non-blocking metadata lookups.
// Canvas rendering has dedicated worker/design tests; exclude cold worker startup
// from these one-second API fast-path assertions.
const workerRender = require("../core/canvas/workerRender");
const originalRenderCanvas = workerRender.renderCanvas;
const renderRequests = [];
workerRender.renderCanvas = async type => {
  renderRequests.push(type);
  return require("node:path").join(require("node:os").tmpdir(), `jt-${type}-fast-test.png`);
};
const menuCommand = require("../plugins/commands/menu");
const statusCommand = require("../plugins/commands/status");
workerRender.renderCanvas = originalRenderCanvas;

global.config = { prefix: "/", name_bot: "JOHNTRAN" };
global.client = { commands: new Map() };

function mockApi(sent = []) {
  return {
    getUserInfo() {
      // Simulate a slow optional profile request; menu must not await it.
      return new Promise(() => {});
    },
    getGroupInfo() {
      // Simulate a slow group metadata request; status must not await it.
      return new Promise(() => {});
    },
    sendMessage(payload) {
      sent.push(payload);
      return Promise.resolve({
        message: { msgId: Date.now(), cliMsgId: Date.now() },
        payload
      });
    }
  };
}

test("menu creates and sends its card under one second without waiting for profile API", async () => {
  const sent = [];
  const api = mockApi(sent);
  const event = {
    threadId: "fast-menu-thread",
    type: 2,
    data: { uidFrom: "fast-menu-user", dName: "Tester" }
  };

  const started = performance.now();
  await menuCommand.run({ api, event });
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 1000, `menu fast path took ${elapsed.toFixed(1)}ms`);
  assert.equal(sent.length, 2, "a fast text acknowledgement must precede the single Canvas card message");
  assert.match(sent[0]?.msg || "", /Đang mở danh mục lệnh/,
    "the first Zalo request must acknowledge the command before Canvas work");
  assert.equal(sent[0]?.attachments, undefined, "the early acknowledgement must stay lightweight");
  assert.ok(Array.isArray(sent[1]?.attachments), "the card image must be sent with its caption");
  assert.match(sent[1]?.msg || "", /@Tester/, "the greeting tag should remain inside the card caption");
  assert.match(sent[1]?.msg || "", /Chào bạn|Chào quản trị viên|Chào chủ nhân/,
    "the greeting should stay directly beneath the Canvas image as its caption");
  assert.ok(Array.isArray(sent[1]?.mentions), "the card caption should preserve real Zalo mention metadata");
  assert.equal(renderRequests.filter(type => type === "menu").length, 1, "menu must still request a canvas card");
});

test("status creates and sends its card under one second without waiting for Zalo metadata", async () => {
  const api = mockApi();
  const event = {
    threadId: "fast-status-thread",
    type: 2,
    data: { uidFrom: "fast-status-user", dName: "Tester" }
  };
  const threadData = {
    threadId: event.threadId,
    data: { bot_enabled: true }
  };

  const started = performance.now();
  await statusCommand.run({
    api,
    event,
    threadData,
    Threads: {},
    reply: { error: async message => { throw new Error(message); } }
  });
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 1000, `status fast path took ${elapsed.toFixed(1)}ms`);
  assert.equal(renderRequests.filter(type => type === "status").length, 1, "status must still request a canvas card");
});
