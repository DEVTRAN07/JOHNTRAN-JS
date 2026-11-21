"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const files = [
  "core/handle/handleCommand.js",
  "plugins/commands/card.js",
  "plugins/commands/getavt.js",
  "plugins/commands/getvd.js",
  "plugins/commands/getvoice.js",
  "plugins/commands/girl.js",
  "plugins/commands/infofb.js",
  "plugins/commands/spamsticker.js",
  "plugins/commands/status.js",
  "plugins/commands/stk.js",
  "plugins/commands/tiktok.js",
  "plugins/commands/vdgirl.js"
];

test("slow commands do not send transient processing acknowledgement messages", () => {
  const forbidden = /⏳ Đang (?:mở thư mục|tạo thẻ|lấy ảnh đại diện|tải video gốc|trích audio|tìm và tải ảnh|lấy thông tin Facebook|nạp sticker hiệu ứng|kiểm tra trạng thái bot|tải danh sách 200 khung STK|lấy thông tin TikTok|tìm và tải video)/;

  for (const relativePath of files) {
    const filePath = path.join(__dirname, "..", relativePath);
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, forbidden, relativePath);
  }
});
