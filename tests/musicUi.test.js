"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../core/music/ui");
const { TextStyle } = require("zalo-client");

const COLORS = [TextStyle.Red, TextStyle.Orange, TextStyle.Yellow, TextStyle.Green];

test("SCL styles every title and artist word with randomized non-adjacent colors", () => {
  const phrase = "Em của đêm nay 🌈 qua phố";
  const styles = ui.randomWordColorStyles(phrase, 17, () => 0);
  const styledWords = Array.from(styles, style => phrase.slice(style.start - 17, style.start - 17 + style.len));
  assert.deepEqual(styledWords, ["Em", "của", "đêm", "nay", "qua", "phố"]);
  assert.ok(styles.every(style => COLORS.includes(style.st)));
  assert.ok(styles.every((style, index) => index === 0 || style.st !== styles[index - 1].st));
  assert.equal(styles[0].start, 17, "offset must be based on UTF-16 code units");
});

test("SCL search result keeps fast styled text and colors each track title/artist", () => {
  const result = ui.searchList({
    providerLabel: "SOUNDCLOUD",
    query: "bài hát mới",
    tracks: [
      { title: "Em Của Ngày Hôm Qua", artist: "Sơn Tùng M-TP", duration: 214 },
      { title: "Chạy Ngay Đi", artist: "Sơn Tùng", duration: 240 }
    ],
    page: 1,
    totalPages: 1
  });

  assert.equal(typeof result.msg, "string");
  assert.ok(Array.isArray(result.styles));
  assert.ok(!result.attachments, "search results must remain plain text, not return to Canvas uploads");
  const colorStyles = result.styles.filter(style => COLORS.includes(style.st));
  assert.ok(colorStyles.length >= 12, "both track title/artist lines should be multi-colored");
  const colorWords = colorStyles.map(style => result.msg.slice(style.start, style.start + style.len));
  assert.ok(colorWords.includes("Em"));
  assert.ok(colorWords.includes("Sơn"));
  assert.ok(colorWords.includes("Tùng"));
});

test("SCL random color run count remains bounded on very long text", () => {
  const text = Array.from({ length: 300 }, (_, index) => "word" + index).join(" ");
  const styles = ui.randomWordColorStyles(text, 5, () => 0.5);
  assert.equal(styles.length, 120);
  const last = styles[styles.length - 1];
  assert.ok(text.slice(last.start - 5, last.start - 5 + last.len).endsWith("word299"));
});
