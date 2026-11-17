"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../core/games/noituEngine");
const noitu = require("../core/runtime/services/games/noituService");
const caro = require("../core/runtime/services/games/caroService");
const eventPlugin = require("../plugins/events/noitu");

function makeEvent(threadId) {
  return {
    threadId,
    type: 1,
    data: { uidFrom: "player-1", content: "sinh viên", dName: "Player" }
  };
}

test("Nối Từ fallback event is not blocked by an ended Caro session", async () => {
  const threadId = "noitu-after-caro-" + Date.now();
  const sent = [];
  let stored = {};
  caro.startSolo(threadId, { uid: "caro-player", name: "Caro Player" });
  caro.stop(threadId);
  noitu.sessions.set(threadId, engine.createSession(threadId, "player-1", "Player", () => 0));

  try {
    await eventPlugin.run({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: makeEvent(threadId),
      Users: {
        async getData() { return { data: stored }; },
        async setData(_uid, data) { stored = data; }
      },
      isSelf: false
    });

    assert.equal(noitu.get(threadId).moves, 1);
    assert.match(sent[0].msg, /nối thành công/);
    const month = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
    assert.equal(stored.noitu.points, 1);
    assert.equal(stored.noitu.modes.classic, 1);
    assert.equal(stored.noitu.months[month].classic, 1);
    assert.equal(stored.noitu.months[month].all, 1);
  } finally {
    noitu.stop(threadId);
    caro.finish(threadId);
  }
});

test("Nối Từ keeps its reply when score persistence fails", async () => {
  const threadId = "noitu-score-fail-" + Date.now();
  const sent = [];
  noitu.sessions.set(threadId, engine.createSession(threadId, "player-1", "Player", () => 0));

  try {
    await eventPlugin.run({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: makeEvent(threadId),
      Users: { async getData() { throw new Error("database offline"); }, async setData() {} },
      isSelf: false
    });

    assert.equal(noitu.get(threadId).moves, 1);
    assert.match(sent[0].msg, /nối thành công/);
    assert.match(sent[0].msg, /chưa đồng bộ được điểm/);
  } finally {
    noitu.stop(threadId);
  }
});

test("active Caro still owns plain-text input over the Nối Từ fallback event", async () => {
  const threadId = "noitu-during-caro-" + Date.now();
  const sent = [];
  caro.startSolo(threadId, { uid: "caro-player", name: "Caro Player" });
  noitu.sessions.set(threadId, engine.createSession(threadId, "player-1", "Player", () => 0));

  try {
    await eventPlugin.run({
      api: { async sendMessage(payload) { sent.push(payload); } },
      event: makeEvent(threadId),
      Users: { async getData() { return { data: {} }; }, async setData() {} },
      isSelf: false
    });
    assert.equal(noitu.get(threadId).moves, 0);
    assert.equal(sent.length, 0);
  } finally {
    noitu.stop(threadId);
    caro.finish(threadId);
  }
});
