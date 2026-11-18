"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");

const workerRender = require("../core/canvas/workerRender");
const originalRenderCanvas = workerRender.renderCanvas;
workerRender.renderCanvas = async () => "/tmp/jt-anti-legacy-test.png";
const anti = require("../plugins/commands/anti");

function makeContext({ botRole = "deputy", initial = {}} = {}) {
  const state = { ...initial };
  const sent = [];
  const ownerId = "group-owner";
  const botId = "bot-id";
  const groupInfo = {
    creatorId: ownerId,
    adminIds: botRole === "deputy" ? [botId] : []
  };
  const api = {
    getOwnId() { return botId; },
    async getGroupInfo(threadId) {
      return { gridInfoMap: { [threadId]: groupInfo } };
    },
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return { status: 0 };
    }
  };
  const Threads = {
    async getData() { return { data: { ...state } }; },
    async setDataAndWait(_threadId, next) {
      Object.assign(state, next);
    }
  };
  return {
    state,
    sent,
    context: {
      api,
      event: {
        threadId: "legacy-anti-group",
        type: ThreadType.Group,
        data: { uidFrom: ownerId }
      },
      args: ["link", "on"],
      Threads
    }
  };
}

test("legacy /anti link|undo|spam refuses to enable when the bot is not QTV", async () => {
  for (const feature of ["link", "undo", "spam"]) {
    const fixture = makeContext({ botRole: "member" });
    fixture.context.args = [feature, "on"];
    await anti.run(fixture.context);
    assert.equal(fixture.state["anti_" + (feature === "link" ? "link" : feature === "undo" ? "undo" : "spam")], undefined);
    assert.equal(fixture.sent.length, 1);
    assert.match(fixture.sent[0].payload.msg, /bot chưa có quyền QTV/i);
    assert.doesNotMatch(fixture.sent[0].payload.msg, /Đã bật thành công/i);
  }
});

test("legacy /anti can still disable a feature after the bot loses QTV", async () => {
  const fixture = makeContext({
    botRole: "member",
    initial: { anti_link: true }
  });
  fixture.context.args = ["link", "off"];
  await anti.run(fixture.context);
  assert.equal(fixture.state.anti_link, false);
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.sent[0].payload.msg, /THÔNG BÁO HỆ THỐNG/i);
});

test("legacy /anti can enable a feature when both requester and bot have group QTV", async () => {
  const fixture = makeContext({ botRole: "deputy" });
  fixture.context.args = ["undo", "on"];
  await anti.run(fixture.context);
  assert.equal(fixture.state.anti_undo, true);
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.sent[0].payload.msg, /THÔNG BÁO HỆ THỐNG/i);
});

test.after(() => {
  workerRender.renderCanvas = originalRenderCanvas;
});
