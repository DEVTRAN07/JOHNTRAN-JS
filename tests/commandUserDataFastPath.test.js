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
  const event = {
    threadId: "private-user-data-fast",
    type: ThreadType.User,
    data: { uidFrom: uid, content: "/probe" }
  };
  const originalRun = command.run;
  command.run = async ({ userData, api: wrappedApi }) => {
    receivedUserData = userData;
    await wrappedApi.sendMessage({ msg: "OK" }, event.threadId, event.type);
  };
  try {
    await handleCommand("/probe", event, makeApi(sent), {}, "/", { data: {} });
    return { receivedUserData, sent };
  } finally {
    command.run = originalRun;
  }
}

test("ordinary commands do not perform a user-record read before dispatch", async () => {
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
    config: { name: "probe", role: 0, cooldowns: 0 },
    run: async () => {}
  };
  global.client = { commands: new Map([["probe", command]]), cooldowns: new Map() };
  Users.getCachedData = () => { cacheReads++; throw new Error("should not read the user cache"); };
  Users.getData = async () => { storageReads++; throw new Error("should not read user storage"); };

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

test("commands can opt in to the legacy userData preload explicitly", async () => {
  const previousConfig = global.config;
  const previousClient = global.client;
  const previousUsers = global.users;
  const originalCached = Users.getCachedData;
  const originalGetData = Users.getData;
  const record = { userId: "requires-user-data", data: { name: "Cached profile" } };
  let cacheReads = 0;
  let storageReads = 0;

  global.config = { prefix: "/", allow_private_command: true, admin: {} };
  global.users = { admin: [], support: [] };
  const command = {
    config: { name: "probe", role: 0, cooldowns: 0, requiresUserData: true },
    run: async () => {}
  };
  global.client = { commands: new Map([["probe", command]]), cooldowns: new Map() };
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
