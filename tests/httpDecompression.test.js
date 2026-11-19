"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { _test } = require("../core/http");

test("external HTTP helper asynchronously decodes gzip, deflate and Brotli bodies", async () => {
  const source = Buffer.from(JSON.stringify({
    ok: true,
    message: "large compressed response",
    repeated: "JOHNTRAN ".repeat(1000)
  }), "utf8");

  const cases = [
    ["gzip", zlib.gzipSync(source)],
    ["deflate", zlib.deflateSync(source)],
    ["br", zlib.brotliCompressSync(source)]
  ];

  for (const [encoding, compressed] of cases) {
    const result = await _test.decodeBody(compressed, encoding);
    assert.deepEqual(result, source, encoding + " body should be decoded");
  }
});

test("compressed HTTP decoding yields to the event loop", async () => {
  const source = crypto.randomBytes(8 * 1024 * 1024);
  const compressed = zlib.gzipSync(source);
  let timerFired = false;
  const timer = setTimeout(() => { timerFired = true; }, 0);

  let decoded;
  try {
    const pending = _test.decodeBody(compressed, "gzip");
    assert.equal(typeof pending?.then, "function", "decodeBody must return a Promise");
    decoded = await pending;
  } finally {
    clearTimeout(timer);
  }

  assert.equal(timerFired, true, "timers should run while zlib decodes in the worker pool");
  assert.deepEqual(decoded, source);
});

test("identity and unsupported encodings preserve the original buffer", async () => {
  const source = Buffer.from("plain response");
  assert.equal(await _test.decodeBody(source, "identity"), source);
  assert.equal(await _test.decodeBody(source, ""), source);
  assert.equal(await _test.decodeBody(source, "unsupported"), source);
});
