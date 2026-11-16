"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const command = require("../plugins/commands/noitu");
const noitu = require("../core/runtime/services/games/noituService");
const noituEngine = require("../core/games/noituEngine");
const ghepChu = require("../core/runtime/services/games/ghepchuService");

function fakeApi() {
  const messages = [];
  return {
    messages,
    async sendMessage(payload) {
      messages.push(payload);
      return { ok: true };
    }
  };
}

function event(threadId, uid, content) {
  return {
    threadId,
    type: 2,
    data: { uidFrom: uid, content }
  };
}

afterEach(() => {
  noitu.sessions.clear();
  ghepChu.clear();
  ghepChu.clearDictionaryCache();
});

test("messages from users outside an active nt go session remain normal chat", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const consumed = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "other-user", "sinh viên"),
    eventType: "message"
  });

  assert.equal(consumed, false);
  assert.equal(api.messages.length, 0);
  assert.equal(session.moves, 0);
});

test("nt go accepts a plain-text answer without a prefix and replies with plain text", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const consumed = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "player-1", "sinh viên"),
    eventType: "message"
  });

  assert.equal(consumed, true);
  assert.equal(session.moves, 1);
  assert.match(api.messages[0].msg, /sinh viên/);
  assert.equal(api.messages.some(message => message.attachments), false);
});

test("nt go consumes an active player's wrong answer but never scores it", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const consumed = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "player-1", "bàn ghế"),
    eventType: "message"
  });

  assert.equal(consumed, true);
  assert.equal(session.moves, 0);
  assert.match(api.messages[0].msg, /Chưa nối đúng/);
});

test("out-of-turn nt go messages are isolated from normal group event handlers", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noituEngine.join(session, "player-2", "Player 2");
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const consumed = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "player-2", "sinh viên"),
    eventType: "message"
  });

  assert.equal(consumed, true);
  assert.equal(session.moves, 0);
  assert.match(api.messages[0].msg, /Đang đến lượt/);
});

test("prefixed commands are left to the normal command pipeline during nt go", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const consumed = await command._test.handleActiveGameText({
    api,
    event: event("group-1", "player-1", "/nt stop"),
    eventType: "message"
  });

  assert.equal(consumed, false);
  assert.equal(api.messages.length, 0);
});

test("a plain stop ends nt go and releases subsequent messages to normal chat", async () => {
  const session = noituEngine.createSession("group-1", "player-1", "Wuang", () => 0);
  noitu.sessions.set("group-1", session);
  const api = fakeApi();

  const stopped = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "player-1", "stop"),
    eventType: "message"
  });
  const afterStop = await command._test.handleNoiTuText({
    api,
    event: event("group-1", "player-1", "chào mọi người"),
    eventType: "message"
  });

  assert.equal(stopped, true);
  assert.equal(afterStop, false);
  assert.equal(noitu.get("group-1"), null);
});

test("nt gc ignores messages from people who did not start the round", async () => {
  const mockDictionary = async url => {
    const request = new URL(url);
    if (request.pathname.endsWith("/suggest")) {
      return { data: { suggestions: ["trí tuệ", "học sinh", "mặt trời", "bầu trời", "máy tính"] } };
    }
    const word = request.searchParams.get("word");
    return {
      data: {
        exists: true,
        word,
        results: [{
          lang_code: "vi",
          meanings: [{ definition: "Nghĩa tiếng Việt", definition_lang: "vi", source: "Test" }]
        }]
      }
    };
  };
  const started = await ghepChu.start("group-2", "player-1", "Wuang", "", {
    now: 1000,
    random: () => 0,
    getJson: mockDictionary
  });
  assert.equal(started.ok, true);
  const api = fakeApi();

  const consumed = await command._test.handleActiveGameText({
    api,
    event: event("group-2", "other-user", "trí tuệ"),
    eventType: "message"
  });

  assert.equal(consumed, false);
  assert.equal(api.messages.length, 0);
});

test("nt gc accepts plain text from its player and does not consume prefixed commands", async () => {
  const mockDictionary = async url => {
    const request = new URL(url);
    if (request.pathname.endsWith("/suggest")) {
      return { data: { suggestions: ["trí tuệ", "học sinh", "mặt trời", "bầu trời", "máy tính"] } };
    }
    const word = request.searchParams.get("word");
    return {
      data: {
        exists: true,
        word,
        results: [{
          lang_code: "vi",
          meanings: [{ definition: "Nghĩa tiếng Việt", definition_lang: "vi", source: "Test" }]
        }]
      }
    };
  };
  const started = await ghepChu.start("group-2", "player-1", "Wuang", "", {
    now: 1000,
    random: () => 0,
    getJson: mockDictionary
  });
  assert.equal(started.ok, true);
  const api = fakeApi();

  const prefixed = await command._test.handleActiveGameText({
    api,
    event: event("group-2", "player-1", "/menu"),
    eventType: "message"
  });
  const plain = await command._test.handleActiveGameText({
    api,
    event: event("group-2", "player-1", "đáp án không đúng"),
    eventType: "message"
  });

  assert.equal(prefixed, false);
  assert.equal(plain, true);
  assert.match(api.messages[0].msg, /Chưa đúng/);
});
