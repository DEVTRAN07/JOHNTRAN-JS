"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Zalo text send path does not synchronously write per-message debug logs", () => {
  const sendMessagePath = path.join(
    __dirname,
    "..",
    "vendor",
    "zalo-client",
    "dist",
    "api",
    "sendMessage.js"
  );
  const source = fs.readFileSync(sendMessagePath, "utf8");

  assert.doesNotMatch(source, /appendFileSync|writeFileSync|mkdirSync/);
  assert.doesNotMatch(source, /\[vendor-send\]|recall_debug\.log/);
});
