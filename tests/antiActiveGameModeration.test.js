"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");

const listen = require("../core/listen");
const handleEvent = require("../core/handle/handleEvent");
const anti = require("../plugins/commands/anti");
const threadService = require("../core/runtime/services/threadService");

function installGlobals() {
  const previous = {
    config: global.config,
    client: global.client,
    cached: threadService.getCachedData
  };
  global.config = {
    prefix: "/",
    allow_self_anti: false,
    allow_self_command: false
  };
  global.client = {
    events: new Map(),
    commands: new Map([["anti", anti]])
  };
  return () => {
    global.config = previous.config;
    global.client = previous.client;
    threadService.getCachedData = previous.cached;
  };
}

function makeModerationFixture(flag, content, msgType = "webchat") {
  const threadId = "anti-before-game-" + flag;
  const state = { [flag]: true };
  const calls = { deleted: [], sent: [], ownId: 0, groupInfo: 0, game: 0, saves: 0 };
  const api = {
    getOwnId() {
      calls.ownId++;
      return "bot-id";
    },
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
    async removeUserFromGroup() {
      return { errorMembers: [] };
    },
    async sendMessage(payload, id, type) {
      calls.sent.push({ payload, id, type });
      return { status: 0 };
    }
  };
  const Threads = {
    async getData() {
      return { threadId, data: { ...state } };
    },
    async setDataAndWait(_id, next) {
      calls.saves++;
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, next);
      return { threadId, data: { ...state } };
    }
  };
  const event = {
    threadId,
    type: ThreadType.Group,
    isSelf: false,
    data: {
      uidFrom: "member-1",
      dName: "Member",
      msgType,
      content,
      cliMsgId: "cli-" + flag,
      msgId: "msg-" + flag,
      ts: String(Date.now())
    }
  };
  return { threadId, state, calls, api, Threads, event };
}

test("Anti-Word blocks a game participant before Nối Từ / Tiến Lên can consume the message", async () => {
  const restore = installGlobals();
  const fixture = makeModerationFixture("anti_word", "địt mẹ");

  try {
    const result = await listen.dispatchGroupMessageBeforeGame({
      api: fixture.api,
      event: fixture.event,
      Threads: fixture.Threads,
      Users: {},
      gameDispatcher: async () => {
        fixture.calls.game++;
        return true;
      }
    });

    assert.equal(result.consumed, true);
    assert.equal(result.source, "anti");
    assert.equal(result.antiDispatched, true);
    assert.equal(fixture.calls.game, 0, "a blocked message must never reach an active game");
    assert.equal(fixture.calls.deleted.length, 1);
    assert.equal(fixture.calls.deleted[0].onlyMe, false);
    assert.equal(fixture.state.anti_word_warnings["member-1"], 1);
    assert.equal(fixture.calls.sent.length, 1);
    assert.match(fixture.calls.sent[0].payload.msg, /từ ngữ bị cấm/i);
  } finally {
    restore();
  }
});

test("Anti-Link blocks a Zalo invite before a game sees the message", async () => {
  const restore = installGlobals();
  const fixture = makeModerationFixture(
    "anti_link",
    "vào nhóm này https://zalo.me/g/abc123"
  );

  try {
    const result = await listen.dispatchGroupMessageBeforeGame({
      api: fixture.api,
      event: fixture.event,
      Threads: fixture.Threads,
      Users: {},
      gameDispatcher: async () => {
        fixture.calls.game++;
        return true;
      }
    });

    assert.equal(result.source, "anti");
    assert.equal(fixture.calls.game, 0);
    assert.equal(fixture.calls.deleted.length, 1);
    assert.equal(fixture.state.anti_link_warnings["member-1"], 1);
  } finally {
    restore();
  }
});

test("a non-violating game move still reaches the active game after Anti preflight", async () => {
  const restore = installGlobals();
  const fixture = makeModerationFixture("anti_word", "xin chào bạn bè");

  try {
    const result = await listen.dispatchGroupMessageBeforeGame({
      api: fixture.api,
      event: fixture.event,
      Threads: fixture.Threads,
      Users: {},
      gameDispatcher: async () => {
        fixture.calls.game++;
        return true;
      }
    });

    assert.equal(result.consumed, true);
    assert.equal(result.source, "game");
    assert.equal(result.antiDispatched, true);
    assert.equal(fixture.calls.game, 1);
    assert.equal(fixture.calls.deleted.length, 0);
    assert.equal(fixture.calls.sent.length, 0);
    assert.equal(fixture.state.anti_word_warnings, undefined);
  } finally {
    restore();
  }
});

test("normal messages sent after Anti preflight do not run Anti twice", async () => {
  const restore = installGlobals();
  const previousGetData = threadService.getData;
  let antiCalls = 0;
  let passiveCalls = 0;
  const threadId = "anti-skip-duplicate";
  const event = {
    threadId,
    type: ThreadType.Group,
    isSelf: false,
    data: { uidFrom: "member", msgType: "webchat", content: "hello", cliMsgId: "c", msgId: "m" }
  };
  const api = { async sendMessage() { return { status: 0 }; } };

  threadService.getCachedData = () => ({
    threadId,
    data: { bot_enabled: true }
  });
  threadService.getData = async () => ({
    threadId,
    data: { bot_enabled: true }
  });
  global.client = {
    events: new Map(),
    commands: new Map([
      ["anti", { config: { name: "anti" }, handleEvent: async () => { antiCalls++; } }],
      ["passive", { config: { name: "passive" }, handleEvent: async () => { passiveCalls++; } }]
    ])
  };

  try {
    await handleEvent("message", event, api, false, {
      skipAnti: true,
      skipGameConsumers: true
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(antiCalls, 0, "Anti already ran before the active-game dispatcher");
    assert.equal(passiveCalls, 1, "other message plugins must still receive the event");
  } finally {
    threadService.getData = previousGetData;
    restore();
  }
});
