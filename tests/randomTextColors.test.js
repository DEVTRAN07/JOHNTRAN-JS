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

test("bot text receives random Zalo colors per word without changing message content", () => {
  const output = styledText.randomize(SAMPLE, { random: () => 0.5 });
  const words = [...SAMPLE.matchAll(/[\p{L}\p{N}]+/gu)];
  const colors = output.styles.filter(style => COLOR_STYLES.has(style.st));

  assert.equal(output.msg, SAMPLE);
  assert.equal(colors.length, words.length);
  assert.deepEqual(
    colors.map(style => ({ start: style.start, len: style.len })),
    words.map(match => ({ start: match.index, len: match[0].length }))
  );

  for (let index = 1; index < colors.length; index++) {
    assert.notEqual(colors[index].st, colors[index - 1].st);
  }
});

test("random colors do not overwrite mention or bold formatting ranges", () => {
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
  assert.ok(output.styles.some(style =>
    style.start === bold.start && style.len === bold.len && style.st === TextStyle.Bold
  ));

  const colorStyles = output.styles.filter(style => COLOR_STYLES.has(style.st));
  for (const style of colorStyles) {
    const end = style.start + style.len;
    assert.ok(end <= mention.pos || style.start >= mention.pos + mention.len,
      "random color must not overlap the mention");
    assert.ok(end <= bold.start || style.start >= bold.start + bold.len,
      "random color must not overwrite the bold range");
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

test("each newly rendered Canvas gets a palette seed for randomized card text", () => {
  const { ctx } = theme.newCanvas(320, 120);
  assert.ok(Number.isSafeInteger(ctx.__jtRenderSeed));
  assert.ok(ctx.__jtRenderSeed >= 0);
});
