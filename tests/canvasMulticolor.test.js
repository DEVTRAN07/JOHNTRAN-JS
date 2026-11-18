"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas } = require("canvas");
const theme = require("../core/canvas/theme");
const { renderCard } = require("../core/canvas");

function captureTextDraws(ctx) {
  const draws = [];
  const original = ctx.fillText.bind(ctx);
  ctx.fillText = (value, x, y) => {
    draws.push({ value: String(value), x, y, color: ctx.fillStyle });
    return original(value, x, y);
  };
  return draws;
}

test("Canvas text defaults to per-word multicolor while keeping Vietnamese words intact", () => {
  const canvas = createCanvas(1000, 120);
  const ctx = canvas.getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.text(ctx, "JOHNTRAN nhiều màu sắc tiếng Việt", 20, 58, {
    size: 28,
    color: theme.PALETTE.ink
  });

  const words = draws.filter(item => /[\p{L}\p{N}]/u.test(item.value));
  assert.deepEqual(words.map(item => item.value),
    ["JOHNTRAN", "nhiều", "màu", "sắc", "tiếng", "Việt"]);
  assert.ok(words.every(item => theme.RANDOM_TEXT_COLORS.includes(item.color)));
  assert.ok(words.every((item, index) => index === 0 || item.color !== words[index - 1].color),
    "adjacent words should not reuse the same color");
  assert.ok(new Set(words.map(item => item.color)).size >= 4,
    "the sentence should use several colors, not one color per whole line");
});

test("Canvas button labels use randomized per-word colors", () => {
  const ctx = createCanvas(460, 110).getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.button(ctx, 20, 15, 300, 58, "XEM THÊM", "#65e8ff");

  const words = draws.filter(item => /[\p{L}\p{N}]/u.test(item.value));
  assert.deepEqual(words.map(item => item.value), ["XEM", "THÊM"]);
  assert.ok(words.every(item => theme.RANDOM_TEXT_COLORS.includes(item.color)));
  assert.notEqual(words[0].color, words[1].color);
  assert.ok(words[0].x >= 20 && words[1].x < 320);
});

test("Canvas center and right alignment are preserved for multicolor text", () => {
  const canvas = createCanvas(1000, 120);
  const ctx = canvas.getContext("2d");
  const centered = captureTextDraws(ctx);
  const centerLayout = theme.drawMulticolorText(ctx, "Căn giữa nhiều màu", 500, 40, {
    size: 24,
    align: "center",
    color: theme.PALETTE.ink,
    multicolor: true
  });
  const centerWords = centered.filter(item => /[\p{L}\p{N}]/u.test(item.value));
  assert.equal(centerWords[0].x, 500 - centerLayout.width / 2);

  const rightDraws = [];
  ctx.fillText = (value, x, y) => rightDraws.push({ value: String(value), x, y, color: ctx.fillStyle });
  const rightLayout = theme.drawMulticolorText(ctx, "Căn phải nhiều màu", 900, 80, {
    size: 24,
    align: "right",
    color: theme.PALETTE.ink,
    multicolor: true
  });
  const rightWords = rightDraws.filter(item => /[\p{L}\p{N}]/u.test(item.value));
  assert.equal(rightWords[0].x, 900 - rightLayout.width);
});

test("Canvas keeps semantic success/error colors when requested", () => {
  const canvas = createCanvas(400, 80);
  const ctx = canvas.getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.text(ctx, "ONLINE", 10, 35, {
    size: 18, color: theme.PALETTE.green, multicolor: false
  });
  assert.equal(draws.length, 1);
  assert.equal(draws[0].value, "ONLINE");
  assert.equal(draws[0].color, theme.PALETTE.green);
});

test("semantic accent text is multicolor by default, with an explicit solid-color opt-out", () => {
  const ctx = createCanvas(600, 90).getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.text(ctx, "ĐANG BẬT HOẠT ĐỘNG", 12, 38, {
    size: 20,
    color: theme.PALETTE.green
  });
  const words = draws.filter(item => /[\p{L}\p{N}]/u.test(item.value));
  assert.equal(words.length, 4);
  assert.ok(words.every(item => theme.RANDOM_TEXT_COLORS.includes(item.color)));
  assert.ok(new Set(words.map(item => item.color)).size > 1);
});

test("Vietnamese combining marks stay attached and are not lost while coloring", () => {
  const decomposed = "Tie\u0302\u0301ng Vie\u0323\u0302t";
  const graphemes = theme.splitGraphemes(decomposed);
  assert.ok(graphemes.includes("e\u0302\u0301"));
  assert.ok(graphemes.includes("e\u0323\u0302"));
  assert.equal(graphemes.join(""), decomposed);

  const ctx = createCanvas(700, 90).getContext("2d");
  const draws = captureTextDraws(ctx);
  const result = theme.drawMulticolorText(ctx, decomposed, 12, 40, {
    size: 24, color: "#ffffff", multicolor: true
  });
  assert.equal(result.text, decomposed);
  assert.ok(draws.some(item => item.value.includes("e\u0302\u0301")),
    "the base letter and its combining accents must be drawn together");
  assert.ok(draws.some(item => item.value.includes("e\u0323\u0302")));
});

test("long unbroken URLs and IDs wrap by grapheme without dropping characters", () => {
  const ctx = createCanvas(700, 90).getContext("2d");
  ctx.font = "20px Arial";
  const source = "https://example.com/ID_" + "a".repeat(46);
  const lines = theme.wrapText(ctx, source, 95);
  assert.ok(lines.length > 2);
  assert.equal(lines.join(""), source);
  assert.ok(lines.every(line => ctx.measureText(line).width <= 95));
});

test("letter-spaced Canvas labels preserve each accented Vietnamese grapheme", () => {
  const ctx = createCanvas(800, 90).getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.label(ctx, "Tie\u0302\u0301ng Vie\u0323\u0302t", 10, 42);
  assert.ok(draws.length >= 8);
  assert.ok(draws.some(item => item.value === "E\u0302\u0301"));
  assert.ok(draws.some(item => item.value === "E\u0323\u0302"));
});

test("Custom game and Nối Từ Canvas renderers use word-level multicolor text", () => {
  const root = path.join(__dirname, "..", "core", "canvas");
  for (const file of ["tlmn.js", "sam.js", "caro.js", "ghepchu.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /theme\.drawMulticolorText/,
      file + " must route multi-word card text through the shared renderer");
    assert.match(source, /words\.length > 1/,
      file + " should keep one-character game symbols in their original semantic color");
  }
  const guide = fs.readFileSync(path.join(root, "noituGuide.js"), "utf8");
  assert.match(guide, /theme\.drawMulticolorText/);
  assert.match(guide, /ĐẠI CHIẾN TỪ VỰNG TIẾNG VIỆT/);
});

test("Canvas labels, menu cards, generic cards and music branding use the shared multicolor renderer", () => {
  const canvas = createCanvas(1000, 120);
  const ctx = canvas.getContext("2d");
  const draws = captureTextDraws(ctx);
  theme.label(ctx, "JOHNTRAN / MENU", 10, 35, { size: 12 });
  const labelColors = new Set(draws.map(item => item.color));
  assert.ok(labelColors.size >= 4, "Canvas labels should use multiple palette colors");

  const menuSource = fs.readFileSync(path.join(__dirname, "..", "core/canvas/menu.js"), "utf8");
  const musicSource = fs.readFileSync(path.join(__dirname, "..", "core/canvas/music.js"), "utf8");
  assert.match(menuSource, /theme\.drawMulticolorText/);
  assert.match(musicSource, /theme\.drawMulticolorText/);

  const card = renderCard({
    title: "Thông báo nhiều màu",
    subtitle: "Một câu có nhiều sắc độ",
    sections: [
      { title: "TRẠNG THÁI", lines: ["JOHNTRAN đang hoạt động bình thường"] },
      { title: "THÔNG TIN", lines: ["Tất cả nội dung card đều được tô màu theo từ"] }
    ],
    footer: "JOHNTRAN"
  });
  const png = card.toBuffer("image/png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 1000);
});
