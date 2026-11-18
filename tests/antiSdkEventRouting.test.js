"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ThreadType,
  Reaction,
  Reactions,
  GroupEventType,
  initializeGroupEvent
} = require("zalo-client");

const handleEvent = require("../core/handle/handleEvent");
const Threads = require("../core/runtime/services/threadService");
const anti = require("../plugins/commands/anti");

async function waitFor(predicate, label, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for " + label);
}

function installAntiRuntime({ threadId, initialData }) {
  const previousClient = global.client;
  const previousConfig = global.config;
  const previousReactionCache = global.antiReactionSpamCache;
  const previousCached = Threads.getCachedData;
  const previousGetData = Threads.getData;
  const previousSet = Threads.setDataAndWait;
  const state = { ...initialData };
  const calls = { sent: [], kicked: [], deleted: [], ownId: 0, groupInfo: 0 };

  const rawApi = {
    getOwnId() {
      calls.ownId++;
      return "bot-id";
    },
    async getGroupInfo(id) {
      calls.groupInfo++;
      return {
        gridInfoMap: {
          [id]: { creatorId: "bot-id", adminIds: [] }
        }
      };
    },
    async sendMessage(payload, id, type) {
      calls.sent.push({ payload, id, type });
      return true;
    },
    async deleteMessage(destination, onlyMe) {
      calls.deleted.push({ destination, onlyMe });
      return { status: 0 };
    },
    async undo(payload, id, type) {
      calls.deleted.push({ payload, id, type, undo: true });
      return { status: 0 };
    },
    async removeUserFromGroup(uid, id) {
      calls.kicked.push({ uid, id });
      return { errorMembers: [] };
    }
  };

  Threads.getCachedData = id => id === threadId
    ? { threadId, data: { bot_enabled: true } }
    : null;
  Threads.getData = async id => ({ threadId: id, data: state });
  Threads.setDataAndWait = async (_id, next) => {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, next);
    return { threadId: _id, data: state };
  };

  global.config = { prefix: "/", allow_self_anti: false };
  global.antiReactionSpamCache = new Map();
  global.client = {
    events: new Map(),
    commands: new Map([["anti", anti]])
  };

  return {
    api: rawApi,
    state,
    calls,
    restore() {
      global.client = previousClient;
      global.config = previousConfig;
      global.antiReactionSpamCache = previousReactionCache;
      Threads.getCachedData = previousCached;
      Threads.getData = previousGetData;
      Threads.setDataAndWait = previousSet;
    }
  };
}

test("real zalo-client Reaction objects reach Anti-Reaction through the runtime dispatcher", async () => {
  const threadId = "sdk-reaction-route";
  const runtime = installAntiRuntime({ threadId, initialData: { anti_reaction: true } });

  try {
    for (let i = 1; i <= 6; i++) {
      const raw = {
        actionId: "action-" + i,
        msgId: String(1000 + i),
        cliMsgId: String(2000 + i),
        msgType: "reactions",
        uidFrom: "member-1",
        idTo: threadId,
        dName: "Member",
        content: {
          rMsg: [{
            gMsgID: 3000 + i,
            cMsgID: 4000 + i,
            msgType: 1
          }],
          rIcon: Reactions.LIKE,
          rType: 3,
          source: 6
        },
        ts: String(Date.now()),
        ttl: 0
      };
      const reactionEvent = new Reaction("bot-id", raw, true);

      assert.equal(reactionEvent.isGroup, true);
      assert.equal(reactionEvent.threadId, threadId);
      assert.equal(reactionEvent.isSelf, false);
      await handleEvent("reaction", reactionEvent, runtime.api, false);
    }

    await waitFor(
      () => runtime.state.anti_reaction_warnings?.["member-1"] === 1 && runtime.calls.sent.length === 1,
      "first Anti-Reaction warning from SDK events"
    );

    assert.equal(runtime.calls.kicked.length, 0);
    assert.equal(runtime.calls.sent.length, 1);
    assert.match(runtime.calls.sent[0].payload.msg, /hơn 5 reaction\/10 giây/i);
    assert.equal(runtime.calls.groupInfo, 1, "the role lookup should be shared across the burst");
  } finally {
    runtime.restore();
  }
});

test("real zalo-client GroupEvent JOIN objects reach Anti-Join through the runtime dispatcher", async () => {
  const threadId = "sdk-group-join-route";
  const runtime = installAntiRuntime({ threadId, initialData: { anti_join: true } });

  try {
    for (let count = 1; count <= 5; count++) {
      const eventData = {
        groupId: threadId,
        creatorId: "owner-id",
        sourceId: "inviter-id",
        updateMembers: [{
          id: "rejoining-member",
          dName: "Rejoining member",
          avatar: "",
          type: 0,
          avatar_25: ""
        }],
        groupSetting: null,
        groupTopic: null,
        info: null,
        extraData: null,
        time: String(Date.now()),
        avt: null,
        fullAvt: null,
        isAdd: 1,
        hideGroupInfo: 0,
        version: "1",
        groupType: 1
      };
      const groupEvent = initializeGroupEvent(
        "bot-id",
        eventData,
        GroupEventType.JOIN,
        "join"
      );

      assert.equal(groupEvent.type, "join");
      assert.equal(groupEvent.threadId, threadId);
      assert.equal(groupEvent.isSelf, false);
      await handleEvent("group_event", groupEvent, runtime.api, false);

      if (count <= 4) {
        await waitFor(
          () => count === 1
            ? Array.isArray(runtime.state.anti_join_history?.["rejoining-member"])
            : runtime.state.anti_join_warnings?.["rejoining-member"] === count - 1,
          "Anti-Join strike " + Math.max(0, count - 1)
        );
      }
    }

    await waitFor(
      () => runtime.calls.kicked.length === 1 &&
        runtime.state.anti_join_warnings?.["rejoining-member"] === undefined &&
        runtime.state.anti_join_history?.["rejoining-member"] === undefined &&
        runtime.calls.sent.length === 4,
      "Anti-Join kick after three warnings"
    );

    assert.equal(runtime.calls.kicked[0].uid, "rejoining-member");
    assert.equal(runtime.state.anti_join_warnings?.["rejoining-member"], undefined);
    assert.equal(runtime.state.anti_join_history?.["rejoining-member"], undefined);
    assert.match(runtime.calls.sent.at(-1).payload.msg, /sau 3 lần cảnh cáo và bị kick/i);
    assert.equal(runtime.calls.groupInfo, 1, "the bot QTV lookup should be reused for the sequence");
  } finally {
    runtime.restore();
  }
});
