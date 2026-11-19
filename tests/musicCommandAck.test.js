"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../core/music");
const commandModule = require("../core/music/command");

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test("/scl acknowledges a selected track before resolve/download work starts", async () => {
  const originalResolve = music.resolve;
  const key = "scl-selection-ack-group:scl-selection-ack-user";
  const sent = [];
  const errors = [];
  let rejectResolve;
  let resolveStarted = false;

  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { ok: true };
    }
  };
  const event = {
    threadId: "scl-selection-ack-group",
    type: 2,
    data: { uidFrom: "scl-selection-ack-user" }
  };
  const track = {
    id: "scl-selection-ack-track",
    title: "A slow track",
    artist: "Test artist",
    duration: 120,
    sourceUrl: "https://soundcloud.com/test/slow-track"
  };

  music.setPending(key, "scl", [track], "slow track", 1);
  music.resolve = async () => {
    resolveStarted = true;
    return new Promise((_resolve, reject) => { rejectResolve = reject; });
  };

  try {
    const command = commandModule.createMusicCommand("scl");
    assert.equal(command.config.backgroundExecution, true);

    const run = command.run({
      api,
      event,
      args: ["1"],
      reply: { async error(message) { errors.push(message); } },
      Threads: {},
      threadData: { threadId: event.threadId, data: {} }
    });

    for (let attempt = 0; attempt < 30 && (!resolveStarted || !sent.length); attempt += 1) {
      await nextTurn();
    }

    assert.equal(resolveStarted, true, "track resolution should start");
    assert.match(sent[0]?.msg || "", /Đã nhận lựa chọn "A slow track"/);
    assert.equal(sent.length, 1, "the status must be sent before the media pipeline completes");

    rejectResolve(new Error("test-only resolver stop"));
    await run;
    assert.equal(errors.length, 1);
    assert.match(errors[0], /test-only resolver stop/);
  } finally {
    music.resolve = originalResolve;
    music.clearPending(key);
  }
});

test("/scl acknowledges before waiting for SoundCloud search", async () => {
  const originalSearch = music.search;
  const originalResolve = music.resolve;
  const sent = [];
  let releaseSearch;
  let searchStarted = false;

  music.search = async () => {
    searchStarted = true;
    return new Promise(resolve => { releaseSearch = resolve; });
  };
  music.resolve = async () => null;

  const api = {
    async sendMessage(payload) {
      sent.push(payload);
      return { message: { msgId: sent.length, cliMsgId: sent.length } };
    }
  };
  const command = commandModule.createMusicCommand("scl");
  const event = {
    threadId: "scl-fast-ack-group",
    type: 2,
    data: { uidFrom: "scl-fast-ack-user" }
  };

  try {
    const run = command.run({
      api,
      event,
      args: ["a", "slow", "track"],
      threadData: { threadId: event.threadId, data: {} },
      Threads: {}
    });

    for (let attempt = 0; attempt < 20 && !searchStarted; attempt += 1) {
      await nextTurn();
    }

    assert.equal(searchStarted, true, "the provider search should have started");
    assert.match(sent[0]?.msg || "", /Đang tìm "a slow track"/);
    assert.equal(sent.length, 1, "no final list should be sent before search resolves");

    releaseSearch([{
      id: "track-1",
      title: "Test track",
      artist: "Test artist",
      duration: 120,
      sourceUrl: "https://soundcloud.com/test/track"
    }]);

    await run;
    assert.equal(sent.length, 2);
    assert.match(sent[1]?.msg || "", /Test track/);
    // Run the scheduled stream prefetch while the mocked resolver is installed.
    await nextTurn();
  } finally {
    music.search = originalSearch;
    music.resolve = originalResolve;
  }
});
