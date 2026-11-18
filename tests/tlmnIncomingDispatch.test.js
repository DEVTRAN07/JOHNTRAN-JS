"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { ThreadType } = require("zalo-client");

const noituPath = require.resolve("../plugins/commands/noitu");
const tlmnPath = require.resolve("../plugins/commands/tlmn");
const noituOriginal = require.cache[noituPath];
const tlmnOriginal = require.cache[tlmnPath];

function mockModule(filename, exports) {
  const mocked = new Module(filename, module);
  mocked.filename = filename;
  mocked.loaded = true;
  mocked.exports = exports;
  require.cache[filename] = mocked;
}

const originalConfig = global.config;
const calls = { noitu: [], tlmn: [] };
mockModule(noituPath, {
  async handleEvent(context) {
    calls.noitu.push(context);
    return false;
  }
});
mockModule(tlmnPath, {
  async handleIncoming(context) {
    calls.tlmn.push(context);
    return true;
  }
});

const listener = require("../core/listen");

test("plain text messages reach TLMN after Nối Từ declines them", async () => {
  calls.noitu.length = 0;
  calls.tlmn.length = 0;
  global.config = { allow_self_command: false };

  const api = {};
  const Users = {};
  const Threads = {};
  const event = {
    type: 1,
    threadId: "group-1",
    data: { uidFrom: "player-1", content: "kr" }
  };

  const consumed = await listener.dispatchActiveGameMessage({
    api, event, Users, Threads, isSelf: false
  });

  assert.equal(consumed, true);
  assert.equal(calls.noitu.length, 1);
  assert.equal(calls.tlmn.length, 1);
  assert.equal(calls.tlmn[0].event, event);
  assert.equal(calls.tlmn[0].api, api);
  assert.equal(calls.tlmn[0].Users, Users);
  assert.equal(calls.tlmn[0].Threads, Threads);
  assert.equal(calls.tlmn[0].isSelf, false);
});

test("private messages skip group-only game dispatch entirely", async () => {
  calls.noitu.length = 0;
  calls.tlmn.length = 0;
  global.config = { allow_self_command: true };

  const consumed = await listener.dispatchActiveGameMessage({
    api: {},
    event: { type: ThreadType.User, threadId: "user-1", data: { uidFrom: "player-1", content: "hello" } },
    Users: {},
    Threads: {},
    isSelf: false
  });

  assert.equal(consumed, false);
  assert.equal(calls.noitu.length, 0);
  assert.equal(calls.tlmn.length, 0);
});

test("self-account plain text is ignored unless allow_self_command is enabled", async () => {
  calls.noitu.length = 0;
  calls.tlmn.length = 0;
  global.config = { allow_self_command: false };

  const event = {
    type: 1,
    threadId: "group-1",
    isSelf: true,
    data: { uidFrom: "bot-uid", content: "kr" }
  };

  const consumed = await listener.dispatchActiveGameMessage({
    api: {}, event, Users: {}, Threads: {}, isSelf: true
  });

  assert.equal(consumed, false);
  assert.equal(calls.noitu.length, 0);
  assert.equal(calls.tlmn.length, 0);
});

test("self-account plain text reaches TLMN when allow_self_command is enabled", async () => {
  calls.noitu.length = 0;
  calls.tlmn.length = 0;
  global.config = { allow_self_command: true };

  const event = {
    type: 1,
    threadId: "group-1",
    isSelf: true,
    data: { uidFrom: "bot-uid", content: "kr" }
  };

  const consumed = await listener.dispatchActiveGameMessage({
    api: {}, event, Users: {}, Threads: {}, isSelf: true
  });

  assert.equal(consumed, true);
  assert.equal(calls.noitu.length, 1);
  assert.equal(calls.tlmn.length, 1);
  assert.equal(calls.tlmn[0].isSelf, true);
});

test("Nối Từ retains priority and prevents TLMN from consuming its answer", async () => {
  calls.noitu.length = 0;
  calls.tlmn.length = 0;
  global.config = { allow_self_command: false };

  const noituMock = require.cache[noituPath].exports;
  noituMock.handleEvent = async context => {
    calls.noitu.push(context);
    return true;
  };

  const consumed = await listener.dispatchActiveGameMessage({
    api: {},
    event: { type: 1, threadId: "group-1", data: { uidFrom: "player-1", content: "đáp án" } },
    Users: {},
    Threads: {},
    isSelf: false
  });

  assert.equal(consumed, true);
  assert.equal(calls.tlmn.length, 0);
});

test.after(() => {
  if (noituOriginal) require.cache[noituPath] = noituOriginal;
  else delete require.cache[noituPath];
  if (tlmnOriginal) require.cache[tlmnPath] = tlmnOriginal;
  else delete require.cache[tlmnPath];
  if (originalConfig === undefined) delete global.config;
  else global.config = originalConfig;
});
