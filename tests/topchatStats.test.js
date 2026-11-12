"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  vietnamDateKey,
  messageText,
  messageTimestamp,
  aggregateMessages,
  buildRanking
} = require("../core/topchat/stats");

test("vietnamDateKey is stable YYYY-MM-DD for the configured timezone", () => {
  assert.equal(vietnamDateKey("2026-11-12T00:30:00.000Z"), "2026-11-12");
  assert.equal(vietnamDateKey("2026-11-11T16:59:59.000Z"), "2026-11-11");
});

test("messageText handles strings and Zalo attachment objects", () => {
  assert.equal(messageText("  xin chao  "), "xin chao");
  assert.equal(messageText({ title: "  tiêu đề  " }), "tiêu đề");
  assert.equal(messageText({ content: "caption" }), "caption");
  assert.equal(messageText({}), "");
});

test("messageTimestamp accepts seconds, milliseconds and ISO strings", () => {
  assert.equal(messageTimestamp("1794441600"), 1794441600000);
  assert.equal(messageTimestamp(1794441600000), 1794441600000);
  assert.equal(messageTimestamp("2026-11-12T00:00:00Z"), Date.parse("2026-11-12T00:00:00Z"));
});

test("aggregateMessages counts text and media, skips commands, self and other dates", () => {
  const date = "2026-11-12";
  const messages = [
    { data: { uidFrom: "u1", dName: "An", content: "xin chào", ts: "1794441600000", msgType: "text" } },
    { data: { uidFrom: "u1", dName: "An", content: { title: "ảnh" }, ts: "1794441601000", msgType: "photo" } },
    { data: { uidFrom: "u2", dName: "Bình", content: "/menu", ts: "1794441602000", msgType: "text" } },
    { data: { uidFrom: "u3", dName: "Chi", content: "", ts: "1794441603000", msgType: "sticker" } },
    { isSelf: true, data: { uidFrom: "u4", dName: "Bot", content: "bot", ts: "1794441604000", msgType: "text" } },
    { data: { uidFrom: "u5", dName: "Dung", content: "hôm qua", ts: "1794355200000", msgType: "text" } }
  ];

  const counts = aggregateMessages(messages, date, "/");
  assert.equal(counts.u1.count, 2);
  assert.equal(counts.u1.name, "An");
  assert.equal(counts.u3.count, 1);
  assert.equal(counts.u2, undefined);
  assert.equal(counts.u4, undefined);
  assert.equal(counts.u5, undefined);
  assert.equal(buildRanking(counts)[0].uid, "u1");
});

test("aggregateMessages excludes message IDs already counted by realtime", () => {
  const messages = [
    { data: { uidFrom: "u1", cliMsgId: "seen-1", dName: "An", content: "đã đếm", ts: "1794441600000", msgType: "text" } },
    { data: { uidFrom: "u1", cliMsgId: "new-1", dName: "An", content: "chưa đếm", ts: "1794441601000", msgType: "text" } }
  ];
  const counts = aggregateMessages(messages, "2026-11-12", "/", "", ["seen-1"]);
  assert.equal(counts.u1.count, 1);
});
