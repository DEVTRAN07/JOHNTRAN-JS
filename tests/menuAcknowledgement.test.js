"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("menu opens without sending the transient opening acknowledgement", () => {
  const menuPath = path.join(__dirname, "..", "plugins", "commands", "menu.js");
  const source = fs.readFileSync(menuPath, "utf8");

  assert.doesNotMatch(source, /Đang mở danh mục lệnh/);
  assert.doesNotMatch(source, /sendFastAcknowledgement/);
});
