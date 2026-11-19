"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, webcrypto } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const { decodeEventData, inflateEventPayload } = require("../vendor/zalo-client/dist/cjs/core/utils.cjs");

async function makeEncryptedEvent(payload) {
  const keyBytes = randomBytes(32);
  const iv = randomBytes(16);
  const additionalData = randomBytes(16);
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const compressed = deflateSync(Buffer.from(JSON.stringify(payload)));
  const encrypted = await webcrypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData,
    tagLength: 128
  }, key, compressed);
  const packet = Buffer.concat([
    iv,
    additionalData,
    Buffer.from(encrypted)
  ]);

  return {
    parsed: { encrypt: 2, data: packet.toString("base64") },
    cipherKey: keyBytes.toString("base64")
  };
}

test("Zalo encrypted websocket event decodes with async zlib decompression", async () => {
  const payload = {
    data: {
      msgs: [
        { cliMsgId: "fast-1", content: "hello" },
        { cliMsgId: "fast-2", content: "world" }
      ]
    }
  };
  const { parsed, cipherKey } = await makeEncryptedEvent(payload);
  const decoded = await decodeEventData(parsed, cipherKey);

  assert.deepEqual(decoded, payload);
});

test("async event decompressor returns the original zlib payload", async () => {
  const input = Buffer.from(JSON.stringify({
    groupMsgs: Array.from({ length: 200 }, (_, index) => ({
      cliMsgId: "message-" + index,
      content: "message payload ".repeat(30)
    }))
  }));
  const compressed = deflateSync(input);
  const decoded = await inflateEventPayload(compressed);

  assert.deepEqual(Buffer.from(decoded), input);
});

test("event decompressor leaves decompression work asynchronous", async () => {
  const input = Buffer.alloc(24 * 1024 * 1024, 0x61);
  const compressed = deflateSync(input);
  const pending = inflateEventPayload(compressed);
  assert.equal(typeof pending?.then, "function");
  const decoded = await pending;
  assert.equal(decoded.byteLength, input.byteLength);
  assert.equal(decoded[0], 0x61);
  assert.equal(decoded[decoded.length - 1], 0x61);
});
