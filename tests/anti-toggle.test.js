"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const workerRender = require("../core/canvas/workerRender");
const originalRenderCanvas = workerRender.renderCanvas;
const renderedCards = [];
workerRender.renderCanvas = async (type, data) => {
  renderedCards.push({ type, data });
  return "/tmp/jt-anti-toggle-test.png";
};
const { FEATURES, runAntiToggle } = require("../core/runtime/antiToggle");

function makeContext({ requesterId = "group-owner", botRole = "owner", initial = {} } = {}) {
  const calls = { saved: null, sent: [] };
  const api = {
    async getGroupInfo(threadId) {
      return {
        gridInfoMap: {
          [threadId]: {
            creatorId: botRole === "owner" ? requesterId : "another-owner",
            adminIds: botRole === "deputy" ? [requesterId] : []
          }
        }
      };
    },
    async sendMessage(payload, threadId, type) {
      calls.sent.push({ payload, threadId, type });
      return { status: 0 };
    }
  };
  const Threads = {
    async getData() { return { data: { ...initial, ...(calls.saved || {}) } }; },
    async setDataAndWait(threadId, data) { calls.saved = { ...data }; }
  };
  return {
    calls,
    context: {
      api,
      event: {
        threadId: "anti-toggle-group",
        type: ThreadType.Group,
        data: { uidFrom: requesterId }
      },
      args: ["on"],
      Threads
    }
  };
}

test("all dedicated Anti commands map to the correct persisted group flags", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousConfig = global.config;
  process.env.OPENAI_API_KEY = "test-key";
  global.config = { prefix: "/" };
  try {
    for (const [featureName, spec] of Object.entries(FEATURES)) {
      const { context, calls } = makeContext();
      await runAntiToggle(featureName, context);
      assert.equal(calls.saved?.[spec.key], true, featureName + " must enable " + spec.key);
      assert.equal(calls.sent.length, 1);
      assert.match(calls.sent[0].payload.msg, /THÔNG BÁO HỆ THỐNG/i);
      assert.deepEqual(calls.sent[0].payload.attachments, ["/tmp/jt-anti-toggle-test.png"]);
      assert.equal(calls.sent[0].payload.ttlKind, "card");
      assert.equal(renderedCards.at(-1).type, "card");
      assert.match(renderedCards.at(-1).data.title, /THÔNG BÁO HỆ THỐNG/);
      assert.match(renderedCards.at(-1).data.subtitle, /Đã bật thành công/);

      context.args = ["off"];
      await runAntiToggle(featureName, context);
      assert.equal(calls.saved?.[spec.key], false, featureName + " must disable " + spec.key);
      assert.match(renderedCards.at(-1).data.subtitle, /Đã tắt thành công/);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
  }
});

test("Anti toggles reject non-admin requesters without saving settings", async () => {
  const { context, calls } = makeContext({
    requesterId: "ordinary-member",
    botRole: "member"
  });
  await runAntiToggle("antilink", context);
  assert.equal(calls.saved, null);
  assert.match(calls.sent[0].payload.msg, /Chỉ trưởng nhóm hoặc phó nhóm/i);
});

test("antinude cannot be enabled without an OpenAI API key", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousAlias = process.env.JT_ANTINUDE_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.JT_ANTINUDE_OPENAI_API_KEY;
  const { context, calls } = makeContext();
  try {
    await runAntiToggle("antinude", context);
    assert.equal(calls.saved, null);
    assert.match(calls.sent[0].payload.msg, /OPENAI_API_KEY/i);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousAlias === undefined) delete process.env.JT_ANTINUDE_OPENAI_API_KEY;
    else process.env.JT_ANTINUDE_OPENAI_API_KEY = previousAlias;
  }
});


test.after(() => {
  workerRender.renderCanvas = originalRenderCanvas;
});


test("Anti toggle keeps a readable confirmation when Canvas rendering fails", async () => {
  const previousRender = workerRender.renderCanvas;
  workerRender.renderCanvas = async () => { throw new Error("Canvas test failure"); };
  const { context, calls } = makeContext();
  try {
    await runAntiToggle("antilink", context);
    assert.equal(calls.saved?.anti_link, true);
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /ℹ️ THÔNG BÁO HỆ THỐNG/);
    assert.match(calls.sent[0].payload.msg, /Đã bật thành công chế độ Anti-Link/);
    assert.equal(calls.sent[0].payload.attachments, undefined);
  } finally {
    workerRender.renderCanvas = previousRender;
  }
});
