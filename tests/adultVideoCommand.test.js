"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ThreadType } = require("zalo-client");
const command = require("../plugins/commands/getvd");

test("/vd 18+ is detected without changing normal /vd reply behavior", () => {
  assert.equal(command._test.isAdultVideoRequest(["18+"]), true);
  assert.equal(command._test.isAdultVideoRequest(["18+", "anime"]), true);
  assert.equal(command._test.isAdultVideoRequest([]), false);
  assert.equal(command._test.isAdultVideoRequest(["random"]), false);
});

test("/vd 18+ without a search term uses the external random endpoint", () => {
  const url = new URL(command._test.buildAdultVideoApiUrl(["18+"]));
  assert.equal(url.origin, "https://adultembed.com");
  assert.equal(url.pathname, "/api/v1/videos/random");
  assert.equal(url.searchParams.get("count"), "1");
});

test("/vd 18+ keyword searches the external catalogue with bounded results", () => {
  const url = new URL(command._test.buildAdultVideoApiUrl(["18+", "romance", "couple"]));
  assert.equal(url.pathname, "/api/v1/search");
  assert.equal(url.searchParams.get("query"), "romance couple");
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("sort"), "popular");
  assert.equal(url.searchParams.get("quality"), "complete");
});

test("/vd 18+ normalizes catalogue results and ignores invalid IDs", () => {
  const rows = command._test.normalizeAdultVideoResults({
    results: [{ id: 123, title: "Scene" }, { id: "bad" }, { title: "No ID" }]
  });
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].id), 123);
});

test("/vd 18+ formats player links instead of downloading or rehosting video files", () => {
  const message = command._test.formatAdultVideoResults([
    { id: 123, title: "Sample scene", duration: "00:12:34", studio: { name: "Studio" } }
  ], "romance");
  assert.match(message, /TÌM VIDEO 18\+/);
  assert.match(message, /Sample scene/);
  assert.match(message, /00:12:34/);
  assert.match(message, /https:\/\/adultembed\.com\/player\/embed\/123\//);
  assert.match(message, /chỉ dành cho người từ đủ 18 tuổi/i);
  assert.doesNotMatch(message, /attachments/);
});

test("/vd 18+ refuses group chats before making an API request", async () => {
  let sent = null;
  await command.run({
    api: { sendMessage: async payload => { sent = payload; } },
    event: { threadId: "group-1", type: ThreadType.Group, data: {} },
    args: ["18+"]
  });
  assert.ok(sent);
  assert.match(sent.msg, /chỉ hoạt động trong tin nhắn riêng/i);
});
