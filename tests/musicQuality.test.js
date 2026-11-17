"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../core/music");
const musicCommand = require("../core/music/command");
const utils = require("../utils");

test("/scl selection preserves the quality chosen during search", async () => {
  const threadId = "scl-quality-test";
  const uid = "music-user";
  const track = { id: "track-1", title: "Test", artist: "Artist", sourceUrl: "" };
  const key = music.pickKey(threadId, uid);
  const pending = { providerName: "scl", tracks: [track], query: "test", page: 1, quality: 320 };
  const original = {
    getPending: music.getPending,
    clearPending: music.clearPending,
    resolve: music.resolve,
    downloadToFile: music.downloadToFile,
    processAudio: utils.processAudio
  };
  let passedQuality = null;

  music.getPending = () => pending;
  music.clearPending = () => {};
  music.resolve = async () => "https://cdn.sndcdn.com/stream";
  music.downloadToFile = async (_url, _extension, options) => {
    passedQuality = options.quality;
    return "/tmp/johntran-test-track.mp3";
  };
  utils.processAudio = async () => "https://cdn.example/voice.m4a";

  try {
    await musicCommand.runMusic("scl", {
      api: { async sendVoice() {} },
      event: { threadId, type: 1, data: { uidFrom: uid } },
      args: ["1"],
      reply: {
        async working() {},
        async done() {},
        async failed() {},
        async error() {}
      }
    });
    assert.equal(passedQuality, 320);
  } finally {
    music.getPending = original.getPending;
    music.clearPending = original.clearPending;
    music.resolve = original.resolve;
    music.downloadToFile = original.downloadToFile;
    utils.processAudio = original.processAudio;
    music.clearPending(key);
  }
});
