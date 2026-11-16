"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const workerPool = require("../core/workerPool");
const { ThreadType } = require("zalo-client");
const command = require("../plugins/commands/bot");
const handleEvent = require("../core/handle/handleEvent");
const ThreadsService = require("../core/runtime/services/threadService");

global.config = { prefix: "/" };

function createContext(initialEnabled = false, omitSetting = false) {
  const data = omitSetting ? {} : { bot_enabled: initialEnabled };
  const messages = [];
  return {
    data,
    messages,
    Threads: {
      getData: async () => ({ data: { ...data } }),
      setData: async (_id, next) => Object.assign(data, next)
    },
    reply: {
      success: message => messages.push({ type: "success", message }),
      info: message => messages.push({ type: "info", message }),
      error: message => messages.push({ type: "error", message })
    }
  };
}

test("/bot off disables the current group only", async () => {
  const ctx = createContext(true);
  await command.run({
    event: { threadId: "group-1", type: ThreadType.Group },
    args: ["off"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, false);
  assert.equal(ctx.messages.at(-1).type, "success");
});

test("/bot on waits for durable storage before confirming the group is enabled", async () => {
  const ctx = createContext(false);
  let finishSave;
  let replySent = false;
  const Threads = {
    getData: async () => ({ data: { ...ctx.data } }),
    setDataAndWait: async (_id, next) => {
      await new Promise(resolve => { finishSave = resolve; });
      Object.assign(ctx.data, next);
    }
  };
  const reply = {
    ...ctx.reply,
    success: message => { replySent = true; ctx.messages.push({ type:"success", message }); }
  };

  const pending = command.run({
    event: { threadId:"group-await-save", type:ThreadType.Group },
    args:["on"], Threads, reply
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishSave, "function");
  assert.equal(replySent, false, "success must not be sent before the DB confirms the write");

  finishSave();
  await pending;
  assert.equal(ctx.data.bot_enabled, true);
  assert.equal(replySent, true);
});

test("/bot on restores a group previously switched off", async () => {
  const ctx = createContext(false);
  await command.run({
    event: { threadId: "group-2", type: ThreadType.Group },
    args: ["on"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, true);
  assert.match(ctx.messages.at(-1).message, /bật bot/i);
});

test("/bot status lists only explicitly enabled groups (missing setting defaults to OFF)", async () => {
  const calls = [];
  const ids = ["status-on-a", "status-off-b", "status-on-c"];
  const api = {
    getAllGroups: async () => ({ gridVerMap: Object.fromEntries(ids.map(id => [id, 1])) }),
    getGroupInfo: async gid => {
      calls.push(gid);
      return { gridInfoMap: { [gid]: { name: "Name " + gid, avt: "", totalMember: 12 } } };
    }
  };
  const Threads = {
    getAll: () => [
      { threadId: "status-off-b", data: { bot_enabled: false } },
      { threadId: "status-on-c", data: { bot_enabled: true } }
    ]
  };

  const result = await command._test.collectEnabledGroups(api, Threads);
  assert.deepEqual(result.groups.map(group => group.gid), ["status-on-c"]);
  assert.equal(result.totalGroups, 3);
  assert.ok(!calls.includes("status-off-b"), "disabled groups are not loaded for the Canvas card");
});

test("/bot status works with wrapApi's built-in group cache without nested cache deadlock", async () => {
  const { wrapApi } = require("../core/message");
  const cache = require("../core/cache");
  const gid = "bot-status-wrapped-cache-regression";
  cache.caches.groupInfo.delete(gid);
  let groupInfoCalls = 0;
  const rawApi = {
    getAllGroups: async () => ({ gridVerMap: { [gid]: 1 } }),
    getGroupInfo: async id => {
      groupInfoCalls++;
      return { gridInfoMap: { [id]: { name: "Wrapped cache group", avt: "", totalMember: 4 } } };
    }
  };
  const wrappedApi = wrapApi(rawApi, gid, ThreadType.Group, "bot");
  try {
    const result = await Promise.race([
      command._test.collectEnabledGroups(wrappedApi, { getAll: () => [{ threadId: gid, data: { bot_enabled: true } }] }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("nested group cache deadlock")), 1000))
    ]);
    assert.deepEqual(result.groups.map(group => group.gid), [gid]);
    assert.equal(groupInfoCalls, 1);
  } finally {
    cache.caches.groupInfo.delete(gid);
  }
});

test("/bot status sends a Canvas image without a text caption", async () => {
  const sent = [];
  const ctx = createContext(true);
  const api = {
    getAllGroups: async () => ({ gridVerMap: {} }),
    sendMessage: (payload, threadId, type) => {
      sent.push({ payload, threadId, type });
      return { ok: true };
    }
  };

  await command.run({
    api,
    event: { threadId: "group-status-card", type: ThreadType.Group },
    args: ["status"],
    Threads: { ...ctx.Threads, getAll: () => [] },
    reply: ctx.reply
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.msg, "");
  assert.equal(sent[0].payload.ttlKind, "card");
  assert.equal(sent[0].payload.attachments.length, 1);
  const file = sent[0].payload.attachments[0];
  try {
    const png = fs.readFileSync(file);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.ok(png.length > 1000);
  } finally {
    try { fs.unlinkSync(file); } catch {}
    await workerPool.shutdown();
  }
});

test("/bot refuses private conversations", async () => {
  const ctx = createContext(true);
  await command.run({
    event: { threadId: "user-1", type: ThreadType.User },
    args: ["off"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, true);
  assert.equal(ctx.messages.at(-1).type, "error");
});

test("/bot on enables a legacy group whose record has no bot_enabled field", async () => {
  const ctx = createContext(false, true);
  await command.run({
    event: { threadId: "group-legacy-default-off", type: ThreadType.Group },
    args: ["on"],
    Threads: ctx.Threads,
    reply: ctx.reply
  });
  assert.equal(ctx.data.bot_enabled, true);
  assert.match(ctx.messages.at(-1).message, /bật bot/i);
});

test("group event handlers are blocked unless bot_enabled is explicitly true", async () => {
  const previousClient = global.client;
  const originalGetCachedData = ThreadsService.getCachedData;
  let calls = 0;
  const flush = async () => {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
  };
  try {
    ThreadsService.getCachedData = () => ({ data: {} });
    global.client = {
      events: new Map([["test-off", {
        config: { event_type: ["message"] },
        run: async () => { calls++; }
      }]]),
      commands: new Map()
    };
    handleEvent("message", {
      threadId: "group-default-off",
      type: ThreadType.Group,
      data: {}
    }, {}, false);
    await flush();
    assert.equal(calls, 0);

    ThreadsService.getCachedData = () => ({ data: { bot_enabled: true } });
    global.client = {
      events: new Map([["test-on", {
        config: { event_type: ["message"] },
        run: async () => { calls++; }
      }]]),
      commands: new Map()
    };
    handleEvent("message", {
      threadId: "group-explicit-on",
      type: ThreadType.Group,
      data: {}
    }, {}, false);
    await flush();
    assert.equal(calls, 1);
  } finally {
    ThreadsService.getCachedData = originalGetCachedData;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
  }
});
