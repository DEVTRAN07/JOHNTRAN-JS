"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TextStyle } = require("zalo-client");
const styledText = require("../core/styled");
const theme = require("../core/canvas/theme");
const { wrapApi } = require("../core/message");

const COLOR_STYLES = new Set([
  TextStyle.Red,
  TextStyle.Orange,
  TextStyle.Yellow,
  TextStyle.Green
]);

const SAMPLE =
  "🤖 Chào chủ nhân!\n👉 Rất vui được đồng hành, chủ nhân muốn khám phá tính năng nào? 🚀";

test("bot text receives random Zalo colors per visible token without changing any text", () => {
  const output = styledText.randomize(SAMPLE, { random: () => 0.5 });
  const tokens = [...SAMPLE.matchAll(/\S+/gu)];
  const colors = output.styles.filter(style => COLOR_STYLES.has(style.st));

  assert.equal(output.msg, SAMPLE);
  assert.equal(colors.length, tokens.length);
  assert.deepEqual(
    colors.map(style => ({ start: style.start, len: style.len })),
    tokens.map(match => ({ start: match.index, len: match[0].length }))
  );

  for (let index = 1; index < colors.length; index++) {
    assert.notEqual(colors[index].st, colors[index - 1].st);
  }
});

test("mentions remain untouched but words previously styled bold are colored too", () => {
  const msg = "🤖 @Wuang chào chủ nhân, dùng help ngay.";
  const mention = { pos: 3, len: 6, uid: "member-id" };
  const helpStart = msg.indexOf("help");
  const bold = { start: helpStart, len: 4, st: TextStyle.Bold };

  const output = styledText.randomize({
    msg,
    mentions: [mention],
    styles: [bold]
  }, { random: () => 0.2 });

  assert.equal(output.msg, msg);
  assert.ok(!output.styles.some(style =>
    COLOR_STYLES.has(style.st) &&
    style.start < mention.pos + mention.len &&
    mention.pos < style.start + style.len
  ), "random color must not overlap the mention");

  assert.ok(output.styles.some(style =>
    style.start === helpStart && style.len === 4 && COLOR_STYLES.has(style.st)
  ), "a previously bold word should not remain an uncolored gap");
  assert.ok(!output.styles.some(style =>
    style.start === bold.start && style.len === bold.len && style.st === TextStyle.Bold
  ));
});

test("long bot messages retain all characters and color all non-mention tokens", () => {
  const msg = ("Nội dung rất dài để kiểm tra không bị mất chữ khi tô màu. ").repeat(30);
  const output = styledText.randomize(msg, { random: () => 0.7 });
  const expectedTokens = [...msg.matchAll(/\S+/gu)];
  const colorStyles = output.styles.filter(style => COLOR_STYLES.has(style.st));

  assert.equal(output.msg, msg);
  assert.equal(colorStyles.length, expectedTokens.length);
  for (const style of colorStyles) {
    assert.ok(style.start >= 0);
    assert.ok(style.start + style.len <= msg.length);
  }
});

test("Reply.text uses the shared random-color sender", async () => {
  const sent = [];
  const api = {
    sendMessage: async (payload, threadId, type) => {
      sent.push({ payload, threadId, type });
      return { message: null, attachment: [] };
    }
  };

  const wrapped = wrapApi(api, "test-thread", 1, "random-text-test");
  await wrapped.__reply.text(SAMPLE, { recallAfterMs: 0 });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.msg, SAMPLE);
  assert.ok(sent[0].payload.styles.some(style => COLOR_STYLES.has(style.st)));
});

test("Canvas text does not truncate the end of a long label", () => {
  const { ctx } = theme.newCanvas(320, 120);
  const fullText = "Nội dung quan trọng cần hiển thị đầy đủ trên thẻ thông báo";
  const result = theme.drawMulticolorText(ctx, fullText, 10, 40, {
    size: 20,
    maxWidth: 100,
    color: "#ffffff",
    multicolor: true
  });

  assert.equal(result.text, fullText);
  assert.ok(!result.text.endsWith("…"));
});

test("each newly rendered Canvas gets a palette seed for randomized card text", () => {
  const { ctx } = theme.newCanvas(320, 120);
  assert.ok(Number.isSafeInteger(ctx.__jtRenderSeed));
  assert.ok(ctx.__jtRenderSeed >= 0);
});

test("Canvas sanitizing keeps superscript and extended Latin characters", () => {
  const value = "Hệ thống ² ᴬ ᴮ";
  assert.equal(theme.sanitizeGlyphs(value), value);
});
