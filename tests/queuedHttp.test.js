"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("../core/http");
const queuedHttp = require("../core/runtime/queuedHttp");
const { stats } = require("../core/jobQueue");

test("queued HTTP buffer fetches use the shared download lane", async () => {
  const original = http.getBuffer;
  let received;
  http.getBuffer = async (url, options) => {
    received = { url, options };
    return { status: 200, buffer: Buffer.from("queued"), contentType: "video/mp4" };
  };

  const before = stats().download?.completed || 0;
  try {
    const result = await queuedHttp.getBuffer("https://media.example/video.mp4", {
      timeout: 5000,
      retries: 1
    });

    assert.equal(result.status, 200);
    assert.equal(result.buffer.toString(), "queued");
    assert.equal(result.contentType, "video/mp4");
    assert.deepEqual(received, {
      url: "https://media.example/video.mp4",
      options: { timeout: 5000, retries: 1 }
    });
    assert.equal(stats().download.completed, before + 1);
  } finally {
    http.getBuffer = original;
  }
});

test("queued HTTP metadata requests use the shared download lane", async () => {
  const original = http.getJson;
  let received;
  http.getJson = async (url, options) => {
    received = { url, options };
    return { status: 200, data: { ok: true } };
  };

  const before = stats().download?.completed || 0;
  try {
    const result = await queuedHttp.getJson("https://media.example/info", {
      timeout: 7000,
      retries: 0
    });

    assert.deepEqual(result, { status: 200, data: { ok: true } });
    assert.deepEqual(received, {
      url: "https://media.example/info",
      options: { timeout: 7000, retries: 0 }
    });
    assert.equal(stats().download.completed, before + 1);
  } finally {
    http.getJson = original;
  }
});
