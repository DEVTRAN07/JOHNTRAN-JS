"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { GroupMessage, ThreadType } = require("zalo-client");

const listen = require("../core/listen");
const anti = require("../plugins/commands/anti");
const { extractMentions } = require("../core/mentions");

function installGlobals() {
  const previous = { config: global.config, client: global.client };
  global.config = { prefix: "/", allow_self_anti: false, allow_self_command: false };
  global.client = { events: new Map(), commands: new Map([["anti", anti]]) };
  return () => {
    global.config = previous.config;
    global.client = previous.client;
  };
}

function makeRawGroupMessage(threadId, mentions, content = "@Member chào bạn") {
  return {
    actionId: "action-" + threadId,
    msgId: "msg-" + threadId,
    cliMsgId: "cli-" + threadId,
    msgType: "webchat",
    uidFrom: "member-1",
    idTo: threadId,
    dName: "Member",
    content,
    mentions,
    ts: String(Date.now()),
    ttl: 0
  };
}

function makeApi(threadId) {
  const calls = { deleted: [], sent: [], groupInfo: 0 };
  const api = {
    getOwnId() { return "bot-id"; },
    async getGroupInfo(id) {
      calls.groupInfo++;
      return { gridInfoMap: { [id]: { creatorId: "bot-id", adminIds: [] } } };
    },
    async deleteMessage(destination, onlyMe) {
      calls.deleted.push({ destination, onlyMe });
      return { status: 0 };
    },
    async undo(payload, id, type) {
      calls.deleted.push({ payload, id, type, undo: true });
      return { status: 0 };
    },
    async removeUserFromGroup() { return { errorMembers: [] }; },
    async sendMessage(payload, id, type) {
      calls.sent.push({ payload, id, type });
      return { status: 0 };
    }
  };
  const state = { anti_taghide: true };
  const Threads = {
    async getData() { return { threadId, data: { ...state } }; },
    async setDataAndWait(_id, next) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, next);
      return { threadId, data: { ...state } };
    }
  };
  return { api, calls, state, Threads };
}

test("Anti-Tag-Hide does not delete a normal Zalo GroupMessage mention", async () => {
  const restore = installGlobals();
  const threadId = "anti-taghide-normal-sdk";
  const fixture = makeApi(threadId);
  const event = new GroupMessage("bot-id", makeRawGroupMessage(threadId, [
    { uid: "123456789", pos: 0, len: 7, type: 0 }
  ]));

  // Mirror listener's convenience projection; the raw data.mentions payload
  // must remain intact because Anti validates the actual Zalo offsets.
  event.mentions = extractMentions(event.data).map(uid => ({ uid }));

  try {
    assert.equal(event.type, ThreadType.Group);
    assert.equal(event.data.mentions[0].pos, 0);
    assert.deepEqual(event.mentions, [{ uid: "123456789" }]);

    const result = await listen.dispatchGroupMessageBeforeGame({
      api: fixture.api,
      event,
      Threads: fixture.Threads,
      Users: {},
      gameDispatcher: async () => true
    });

    assert.equal(result.source, "game");
    assert.equal(fixture.calls.deleted.length, 0);
    assert.equal(fixture.calls.sent.length, 0);
    assert.equal(fixture.state.anti_taghide_warnings, undefined);
  } finally {
    restore();
  }
});

test("Anti-Tag-Hide removes malformed mention offsets from a real SDK GroupMessage", async () => {
  const restore = installGlobals();
  const threadId = "anti-taghide-malformed-sdk";
  const fixture = makeApi(threadId);
  const event = new GroupMessage("bot-id", makeRawGroupMessage(threadId, [
    { uid: "123456789", pos: 0, len: 0, type: 1 }
  ]));

  event.mentions = extractMentions(event.data).map(uid => ({ uid }));

  try {
    const result = await listen.dispatchGroupMessageBeforeGame({
      api: fixture.api,
      event,
      Threads: fixture.Threads,
      Users: {},
      gameDispatcher: async () => {
        assert.fail("malformed mention must not reach an active game");
      }
    });

    assert.equal(result.source, "anti");
    assert.equal(fixture.calls.deleted.length, 1);
    assert.equal(fixture.calls.deleted[0].onlyMe, false);
    assert.equal(fixture.state.anti_taghide_warnings["member-1"], 1);
    assert.equal(fixture.calls.sent.length, 1);
    assert.match(fixture.calls.sent[0].payload.msg, /nhắc tên ẩn|mention/i);
  } finally {
    restore();
  }
});
