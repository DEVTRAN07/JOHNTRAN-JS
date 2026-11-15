"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { readBody, MAX_BODY_BYTES } = require("../panel/server");

test("panel JSON body parser accepts valid UTF-8 JSON", async () => {
  const body = { name: "JOHNTRAN", description: "Tiếng Việt ✓" };
  const parsed = await readBody(Readable.from([Buffer.from(JSON.stringify(body))]));
  assert.deepEqual(parsed, body);
});

test("panel JSON body parser treats an empty body as an empty object", async () => {
  assert.deepEqual(await readBody(Readable.from([])), {});
  assert.deepEqual(await readBody(Readable.from(["  "])), {});
});

test("panel JSON body parser reports malformed JSON as HTTP 400", async () => {
  await assert.rejects(
    readBody(Readable.from(["{invalid"])),
    (error) => error.statusCode === 400 && error.message === "JSON không hợp lệ"
  );
});

test("panel JSON body parser rejects payloads larger than 1 MiB", async () => {
  assert.equal(MAX_BODY_BYTES, 1024 * 1024);
  const tooLarge = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
  await assert.rejects(
    readBody(Readable.from([tooLarge])),
    (error) => error.statusCode === 413 && error.message === "Payload quá lớn"
  );
});

test("panel JSON body parser accepts payloads exactly at the configured limit", async () => {
  const prefix = Buffer.from('{"value":"');
  const suffix = Buffer.from('"}');
  const body = Buffer.concat([
    prefix,
    Buffer.alloc(MAX_BODY_BYTES - prefix.length - suffix.length, 0x61),
    suffix
  ]);
  const parsed = await readBody(Readable.from([body]));
  assert.equal(Buffer.byteLength(parsed.value), MAX_BODY_BYTES - prefix.length - suffix.length);
});
