"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ThreadType } = require("zalo-client");
const anti = require("../plugins/commands/anti");

function installConfig() {
  const previous = global.config;
  global.config = { prefix: "/", allow_self_anti: false };
  return () => { global.config = previous; };
}

function makeApi(threadId) {
  const calls = { deleted: [], sent: [], kicked: [], ownId: 0, groupInfo: 0 };
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
  return { api, calls };
}

function makeMessageEvent(threadId, content = "địt mẹ") {
  return {
    threadId,
    type: ThreadType.Group,
    isSelf: false,
    data: {
      uidFrom: "member-1",
      dName: "Member",
      msgType: "webchat",
      content,
      cliMsgId: "cli-" + threadId,
      msgId: "msg-" + threadId,
      ts: String(Date.now())
    }
  };
}

test("Anti uses the last committed group cache when the database read is temporarily unavailable", async () => {
  const restore = installConfig();
  const threadId = "anti-cache-database-outage";
  const { api, calls } = makeApi(threadId);
  let cachedReads = 0;
  let databaseReads = 0;
  const Threads = {
    getCachedData(id) {
      cachedReads++;
      assert.equal(id, threadId);
      return { threadId, data: { anti_word: true, bot_enabled: true } };
    },
    async getData() {
      databaseReads++;
      throw new Error("simulated Supabase outage");
    },
    async setDataAndWait() {
      throw new Error("writes are unavailable");
    }
  };

  try {
    const result = await anti.handleEvent({
      api,
      event: makeMessageEvent(threadId),
      eventType: "message",
      isSelf: false,
      Threads
    });

    assert.equal(result?.consumed, true);
    assert.equal(cachedReads, 1);
    assert.equal(databaseReads, 1, "the warning write may fail, but reading the Anti flags must use cache");
    assert.equal(calls.deleted.length, 1, "cached Anti-Word must still remove a violating message");
    assert.equal(calls.deleted[0].onlyMe, false);
    assert.equal(calls.sent.length, 1);
    assert.match(calls.sent[0].payload.msg, /Chưa lưu được cảnh cáo/i);
  } finally {
    restore();
  }
});

test("Anti-Join does not mutate the cached settings snapshot when its durable write fails", async () => {
  const restore = installConfig();
  const threadId = "anti-join-cache-copy";
  const { api, calls } = makeApi(threadId);
  const cachedRecord = {
    threadId,
    data: { anti_join: true }
  };
  let cachedReads = 0;
  let databaseReads = 0;
  let writes = 0;
  const Threads = {
    getCachedData() {
      cachedReads++;
      return cachedRecord;
    },
    async getData() {
      databaseReads++;
      throw new Error("must not cold-read when a committed cache row exists");
    },
    async setDataAndWait(_id, next) {
      writes++;
      assert.ok(Array.isArray(next.anti_join_history?.["member-1"]));
      throw new Error("simulated Supabase write failure");
    }
  };
  const event = {
    threadId,
    type: "join",
    isSelf: false,
    data: {
      updateMembers: [{
        id: "member-1",
        dName: "Member",
        avatar: "",
        type: 0,
        avatar_25: ""
      }]
    }
  };

  try {
    await anti.handleEvent({
      api,
      event,
      eventType: "group_event",
      isSelf: false,
      Threads
    });

    assert.equal(cachedReads, 1);
    assert.equal(databaseReads, 0);
    assert.equal(writes, 1);
    assert.deepEqual(cachedRecord.data, { anti_join: true },
      "failed Anti-Join persistence must not leak uncommitted strike history into cache");
    assert.equal(calls.kicked.length, 0);
  } finally {
    restore();
  }
});

test("Anti still falls back to the durable group read when the cache is cold", async () => {
  const restore = installConfig();
  const threadId = "anti-cache-cold-fallback";
  const { api, calls } = makeApi(threadId);
  const state = { anti_word: true };
  let cachedReads = 0;
  let databaseReads = 0;
  const Threads = {
    getCachedData() {
      cachedReads++;
      return null;
    },
    async getData() {
      databaseReads++;
      return { threadId, data: { ...state } };
    },
    async setDataAndWait(_id, next) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, next);
    }
  };

  try {
    const result = await anti.handleEvent({
      api,
      event: makeMessageEvent(threadId),
      eventType: "message",
      isSelf: false,
      Threads
    });

    assert.equal(result?.consumed, true);
    assert.equal(cachedReads, 1);
    assert.equal(databaseReads, 2, "cold config load plus durable warning transaction");
    assert.equal(calls.deleted.length, 1);
    assert.equal(state.anti_word_warnings["member-1"], 1);
  } finally {
    restore();
  }
});
