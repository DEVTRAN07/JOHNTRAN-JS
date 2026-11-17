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

function mockApi() {
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
      return Promise.resolve({
        message: { msgId: Date.now(), cliMsgId: Date.now() },
        payload
      });
    }
  };
}

test("menu creates and sends its card under one second without waiting for profile API", async () => {
  const api = mockApi();
  const event = {
    threadId: "fast-menu-thread",
    type: 2,
    data: { uidFrom: "fast-menu-user", dName: "Tester" }
  };

  const started = performance.now();
  await menuCommand.run({ api, event });
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 1000, `menu fast path took ${elapsed.toFixed(1)}ms`);
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
