"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const music = require("../core/music");
const utils = require("../utils");

// Keep this command-flow test deterministic: the real command schedules an
// optional decorative Now Playing canvas after the audio has been sent.
const workerRender = require("../core/canvas/workerRender");
const originalRenderCanvas = workerRender.renderCanvas;
workerRender.renderCanvas = async () => __filename;
const musicCommand = require("../core/music/command");
workerRender.renderCanvas = originalRenderCanvas;

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


test("/scl next/prev keeps the selected quality in the pending result", async () => {
  const threadId = "scl-quality-nav-test";
  const uid = "music-user-nav";
  const tracks = Array.from({ length: 9 }, (_, index) => ({ id: "track-" + index, title: "Track " + index }));
  const key = music.pickKey(threadId, uid);
  const original = {
    getPending: music.getPending,
    setPending: music.setPending,
    getProvider: music.getProvider
  };
  let captured = null;
  const pending = { providerName: "scl", tracks, query: "test", page: 1, quality: 320 };

  music.getPending = () => pending;
  music.setPending = (...args) => { captured = args; };
  music.getProvider = () => ({ name: "scl", label: "SoundCloud" });

  try {
    await musicCommand.runMusic("scl", {
      api: { async sendMessage() {} },
      event: { threadId, type: 1, data: { uidFrom: uid } },
      args: ["next"],
      reply: { async error(message) { throw new Error(message); } }
    });
    assert.equal(captured?.[4], 2, "next should move to page two");
    assert.deepEqual(captured?.[5], { quality: 320 });
  } finally {
    music.getPending = original.getPending;
    music.setPending = original.setPending;
    music.getProvider = original.getProvider;
    music.clearPending(key);
  }
});
