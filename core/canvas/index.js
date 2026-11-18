"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { createCanvas } = require("canvas");
const theme = require("./theme");

const THEMES = {
  brand: { accent: "#61d8f2" },
  success: { accent: "#54d6a0" },
  error: { accent: "#ff7188" },
  warn: { accent: "#f3c46b" },
  music: { accent: "#b69cff" },
  ai: { accent: "#8cc7ff" }
};
function sanitize(value) { return theme.sanitizeGlyphs(value); }
function wrapText(ctx, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let current = "";
    for (const word of words) {
      const next = current ? current + " " + word : word;
      if (current && ctx.measureText(next).width > maxWidth) { lines.push(current); current = word; }
      else current = next;
    }
    if (current) lines.push(current);
  }
  return lines;
}
function measureContent(spec = {}) {
  theme.initFonts(); theme.ensureTheme();
  const S = theme.S, width = theme.WIDTH, padding = S(30);
  const contentWidth = width - padding * 2;
  const ctx = createCanvas(width, 8).getContext("2d");
  ctx.font = theme.font(16, "JT");
  const title = wrapText(ctx, sanitize(spec.title || "Thông báo"), contentWidth - S(26));
  let height = S(120) + Math.max(1, title.length) * S(38);
  if (spec.subtitle) {
    ctx.font = theme.font(14, "JT");
    height += wrapText(ctx, sanitize(spec.subtitle), contentWidth - S(28)).length * S(22) + S(10);
  }
  for (const section of (Array.isArray(spec.sections) ? spec.sections : [])) {
    const lines = (Array.isArray(section.lines) ? section.lines : [])
      .flatMap(line => wrapText(ctx, sanitize(line), contentWidth - S(70)));
    height += S(64) + Math.max(1, lines.length) * S(27);
  }
  if (spec.footer) height += S(40);
  return { width, height: Math.max(height + S(24), S(230)), padding, contentWidth };
}
function renderCard(spec = {}) {
  const { width, height, padding, contentWidth } = measureContent(spec);
  const S = theme.S, p = theme.PALETTE;
  const accent = THEMES[spec.theme]?.accent || p.accent;
  const { ctx, canvas } = theme.newCanvas(width, height);
  theme.paintBackground(ctx, width, height);

  const faceX = padding, faceY = S(26), faceW = contentWidth, faceH = height - S(52);
  theme.panel(ctx, faceX, faceY, faceW, faceH, S(18), accent);

  let y = S(51);
  const brandName = String(spec.brand || global.config?.name_bot || "JOHN TRAN").trim() || "JOHN TRAN";
  theme.label(ctx, String(spec.chip || "JOHNTRAN") + "  /  " + brandName,
    padding + S(22), y, { size: 9, color: accent });
  y += S(42);
  wrapText(ctx, sanitize(spec.title || "Thông báo"), contentWidth - S(46)).forEach(line => {
    theme.text(ctx, line, padding + S(22), y, {
      size: 29, family: "JT-Display-Bold", color: p.ink, maxWidth: contentWidth - S(46)
    });
    y += S(37);
  });
  if (spec.subtitle) {
    y += S(2);
    wrapText(ctx, sanitize(spec.subtitle), contentWidth - S(46)).forEach(line => {
      theme.text(ctx, line, padding + S(22), y, {
        size: 14, color: p.ink2, maxWidth: contentWidth - S(46)
      });
      y += S(22);
    });
  }

  (Array.isArray(spec.sections) ? spec.sections : []).forEach((section, index) => {
    y += S(16);
    const lines = (Array.isArray(section.lines) ? section.lines : [])
      .flatMap(line => wrapText(ctx, sanitize(line), contentWidth - S(78)));
    const h = S(54 + Math.max(1, lines.length) * 26);
    const x = padding + S(16), w = contentWidth - S(32);
    theme.panel(ctx, x, y, w, h, S(13), accent);
    theme.text(ctx, String(index + 1).padStart(2, "0"), x + S(15), y + S(24), {
      size: 11, family: "JT-Mono-Bold", color: accent
    });
    if (section.title) theme.label(ctx, section.title, x + S(48), y + S(24), {
      size: 9, color: p.ink2
    });
    lines.forEach((line, lineIndex) => {
      theme.text(ctx, line, x + S(48), y + S(49 + lineIndex * 25), {
        size: 13, color: p.ink, maxWidth: w - S(64)
      });
    });
    y += h;
  });
  if (spec.footer) theme.text(ctx, sanitize(spec.footer), width - padding - S(18),
    height - S(24), {
      size: 9, family: "JT-Mono", color: p.mute, align: "right",
      maxWidth: contentWidth - S(36)
    });
  return canvas;
}
function renderCardToFile(spec = {}, filePath) {
  const canvas = renderCard(spec);
  const outputPath = filePath || path.join(os.tmpdir(),
    "jt_card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}
module.exports = { renderCard, renderCardToFile, sanitize, THEMES, _test: { measureContent, wrapText } };
