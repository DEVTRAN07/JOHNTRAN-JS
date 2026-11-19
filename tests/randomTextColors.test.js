"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TextStyle } = require("zalo-client");
const { createCanvas } = require("canvas");
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

test("bot text receives random Zalo colors per visible token without changing message content", () => {
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

test("mention metadata stays separate while text after the tag receives random colors", () => {
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
  assert.deepEqual(output.mentions, [mention]);
  assert.ok(!output.styles.some(style =>
    style.start < mention.pos + mention.len && mention.pos < style.start + style.len
  ), "text color ranges must not overlap the Zalo-managed @mention tag");
  const greetingStart = msg.indexOf("chào");
  assert.ok(output.styles.some(style =>
    style.start === greetingStart && COLOR_STYLES.has(style.st)
  ), "the greeting immediately after @mention should receive a random color");
  assert.ok(output.styles.some(style =>
    style.start === helpStart && style.len === 4 && COLOR_STYLES.has(style.st)
  ), "a previously bold word should get a random color");
  assert.ok(!output.styles.some(style =>
    style.start === bold.start && style.len === bold.len && style.st === TextStyle.Bold
  ), "overlapping bold style must not collide with the color style");
});

test("long bot messages retain all characters and color every visible token", () => {
  const msg = ("Nội dung rất dài để kiểm tra không bị mất chữ khi tô màu. ").repeat(35);
  const output = styledText.randomize(msg, { random: () => 0.7 });
  const expectedTokens = [...msg.matchAll(/\S+/gu)];
  const colors = output.styles.filter(style => COLOR_STYLES.has(style.st));

  assert.equal(output.msg, msg);
  assert.equal(colors.length, expectedTokens.length);
  for (const style of colors) {
    assert.ok(style.start >= 0);
    assert.ok(style.start + style.len <= msg.length);
  }
});

test("Reply.text uses the common random-color sender", async () => {
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

test("Canvas caption payload retains randomized styles with its image attachment", async () => {
  const sent = [];
  const api = {
    sendMessage: async (payload, threadId, type) => {
      sent.push({ payload, threadId, type });
      return { message: null, attachment: [] };
    }
  };
  const wrapped = wrapApi(api, "caption-thread", 1, "canvas-caption-test");
  const caption = "🤖 Nội dung hiển thị bên dưới card Canvas";
  const imagePath = "/tmp/jt_canvas_preview.png";

  await wrapped.sendMessage({
    msg: caption,
    attachments: [imagePath],
    recallAfterMs: 0
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.msg, caption);
  assert.deepEqual(sent[0].payload.attachments, [imagePath]);
  assert.ok(sent[0].payload.styles.some(style => COLOR_STYLES.has(style.st)));
});

test("vendored Zalo SDK forwards styles into single-image caption payloads", () => {
  const sdkPath = path.join(__dirname, "..", "vendor", "zalo-client", "dist", "api", "sendMessage.js");
  const sdkSource = fs.readFileSync(sdkPath, "utf8");
  const attachmentStart = sdkSource.indexOf("async function handleAttachment");
  const attachmentEnd = sdkSource.indexOf("for (const gif of gifFiles)", attachmentStart);
  assert.ok(attachmentStart >= 0 && attachmentEnd > attachmentStart);

  const attachmentSource = sdkSource.slice(attachmentStart, attachmentEnd);
  assert.ok(attachmentSource.includes("urgency, styles } = opts"));
  assert.ok(attachmentSource.includes("desc: msg"));
  assert.ok(attachmentSource.includes("handleStyles(data.params, styles)"));
});

test("Canvas labels keep their full text instead of replacing the end with ellipsis", () => {
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
  assert.ok(result.segments > 1);
});

test("Canvas retains every line of multiline text", () => {
  const { ctx } = theme.newCanvas(640, 220);
  const fullText = "Dòng đầu tiên có đủ chữ\nDòng thứ hai cũng không bị mất\nDòng ba kết thúc ở đây";
  const result = theme.drawMulticolorText(ctx, fullText, 20, 40, {
    size: 22,
    maxWidth: 560,
    color: "#ffffff",
    multicolor: true
  });

  assert.equal(result.text, fullText);
  assert.equal(
    result.segments,
    [...fullText.matchAll(/[\p{L}\p{N}]+/gu)].length
  );
});

test("each new and legacy Canvas context gets a random color seed", () => {
  const { ctx } = theme.newCanvas(320, 120);
  assert.ok(Number.isSafeInteger(ctx.__jtRenderSeed));
  assert.ok(ctx.__jtRenderSeed >= 0);

  const legacy = createCanvas(320, 120).getContext("2d");
  theme.drawMulticolorText(legacy, "Thẻ Canvas cũ cũng cần phối màu ngẫu nhiên", 10, 40, {
    color: "#ffffff",
    multicolor: true
  });
  assert.ok(Number.isSafeInteger(legacy.__jtRenderSeed));
  assert.ok(legacy.__jtRenderSeed >= 0);
});

test("Canvas sanitizer preserves rare emoji and uncommon Unicode characters", () => {
  const value = "Hệ thống ² ᴬ ᴮ 🪼";
  assert.equal(theme.sanitizeGlyphs(value), value);
});
