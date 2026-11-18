"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const handleCommand = require("../core/handle/handleCommand");
const Users = require("../core/runtime/services/userService");

function makeApi(sent) {
  return {
    async sendMessage(payload, threadId, type) {
      sent.push({ payload, threadId, type });
      return {
        message: { msgId: String(sent.length), cliMsgId: "user-data-fast-" + sent.length }
      };
    }
  };
}

async function execute(command) {
  const sent = [];
  let receivedUserData = "not-called";
  const uid = "user-data-fast-user-" + Math.random().toString(36).slice(2);
  const commandName = String(command.config?.name || "probe").toLowerCase();
  const messageText = "/" + commandName;
  const event = {
    threadId: "private-user-data-fast",
    type: ThreadType.User,
    data: { uidFrom: uid, content: messageText }
  };
  const originalRun = command.run;
  command.run = async ({ userData, api: wrappedApi }) => {
    receivedUserData = userData;
    await wrappedApi.sendMessage({ msg: "OK" }, event.threadId, event.type);
  };
  try {
    await handleCommand(messageText, event, makeApi(sent), {}, "/", { data: {} });
    return { receivedUserData, sent };
  } finally {
    command.run = originalRun;
  }
}

test("built-in commands known not to use userData skip the cold user-record read", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
  const previousUsers = global.users;
  const originalCached = Users.getCachedData;
  const originalGetData = Users.getData;
  let cacheReads = 0;
  let storageReads = 0;

  global.config = { prefix: "/", allow_private_command: true, admin: {} };
  global.users = { admin: [], support: [] };
  const command = {
    config: { name: "stk", role: 0, cooldowns: 0 },
    run: async () => {}
  };
  global.client = { commands: new Map([["stk", command]]), cooldowns: new Map() };
  Users.getCachedData = () => { cacheReads++; throw new Error("built-in fast path must not read user cache"); };
  Users.getData = async () => { storageReads++; throw new Error("built-in fast path must not read user storage"); };

  try {
    const result = await execute(command);
    assert.equal(result.receivedUserData, null);
    assert.equal(result.sent.length, 1);
    assert.equal(cacheReads, 0);
    assert.equal(storageReads, 0);
  } finally {
    Users.getCachedData = originalCached;
    Users.getData = originalGetData;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("legacy custom commands keep the automatic userData preload unless they opt out", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
  const previousUsers = global.users;
  const originalCached = Users.getCachedData;
  const originalGetData = Users.getData;
  const record = { userId: "custom-user-data", data: { name: "Legacy profile" } };
  let cacheReads = 0;
  let storageReads = 0;

  global.config = { prefix: "/", allow_private_command: true, admin: {} };
  global.users = { admin: [], support: [] };
  const command = {
    config: { name: "customprobe", role: 0, cooldowns: 0 },
    run: async () => {}
  };
  global.client = { commands: new Map([["customprobe", command]]), cooldowns: new Map() };
  Users.getCachedData = () => { cacheReads++; return null; };
  Users.getData = async () => { storageReads++; return record; };

  try {
    const result = await execute(command);
    assert.equal(result.receivedUserData, record);
    assert.equal(cacheReads, 1);
    assert.equal(storageReads, 1);
  } finally {
    Users.getCachedData = originalCached;
    Users.getData = originalGetData;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});

test("custom commands can explicitly disable legacy userData preload", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
  const previousUsers = global.users;
  const originalCached = Users.getCachedData;
  const originalGetData = Users.getData;
  let cacheReads = 0;
  let storageReads = 0;

  global.config = { prefix: "/", allow_private_command: true, admin: {} };
  global.users = { admin: [], support: [] };
  const command = {
    config: { name: "custom-fast", role: 0, cooldowns: 0, preloadUserData: false },
    run: async () => {}
  };
  global.client = { commands: new Map([["custom-fast", command]]), cooldowns: new Map() };
  Users.getCachedData = () => { cacheReads++; return null; };
  Users.getData = async () => { storageReads++; return { userId: "custom-fast", data: {} }; };

  try {
    const result = await execute(command);
    assert.equal(result.receivedUserData, null);
    assert.equal(cacheReads, 0);
    assert.equal(storageReads, 0);
  } finally {
    Users.getCachedData = originalCached;
    Users.getData = originalGetData;
    if (previousConfig === undefined) delete global.config;
    else global.config = previousConfig;
    if (previousClient === undefined) delete global.client;
    else global.client = previousClient;
    if (previousUsers === undefined) delete global.users;
    else global.users = previousUsers;
  }
});
