"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../core/music");
const commandModule = require("../core/music/command");

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

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
  } finally {
    music.search = originalSearch;
    music.resolve = originalResolve;
  }
});
