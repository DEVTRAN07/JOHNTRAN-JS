"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { createCanvas } = require("canvas");
const { withMacWindow } = require("./macWindow");
const theme = require("./theme");

// Kept for backwards compatibility with older callers that import THEMES.
const THEMES = {
  brand: { accent: "#d4af37" },
  success: { accent: "#8fbf9f" },
  error: { accent: "#c4594e" },
  warn: { accent: "#d4af37" },
  music: { accent: "#d4af37" },
  ai: { accent: "#d4af37" }
};

function sanitize(value) {
  return theme.sanitizeGlyphs(value);
}

function wrapText(ctx, value, maxWidth) {
  const lines = [];
  for (const paragraph of String(value ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const next = current ? current + " " + word : word;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function measureContent(spec = {}) {
  theme.initFonts();
  theme.ensureTheme();
  const S = theme.S;
  const width = theme.WIDTH;
  const padding = S(32);
  const contentWidth = width - padding * 2;
  const ctx = createCanvas(width, 8).getContext("2d");
  let height = S(115);

  ctx.font = theme.font(31, "JT-Display-Bold");
  const titleLines = wrapText(ctx, sanitize(spec.title || "Thông báo"), contentWidth);
  height += Math.max(1, titleLines.length) * S(39);

  if (spec.subtitle) {
    ctx.font = theme.font(16, "JT");
    height += wrapText(ctx, sanitize(spec.subtitle), contentWidth).length * S(25) + S(12);
  }

  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  for (const section of sections) {
    height += S(22);
    if (section.title) height += S(30);
    ctx.font = theme.font(15, "JT");
    const lines = (Array.isArray(section.lines) ? section.lines : [])
      .flatMap(line => wrapText(ctx, sanitize(line), contentWidth - S(28)));
    height += Math.max(1, lines.length) * S(23) + S(20);
  }
  if (spec.footer) height += S(42);
  return { width, height: Math.max(height + S(28), S(240)), padding, contentWidth };
}

function renderCard(spec = {}) {
  const { width, height, padding, contentWidth } = measureContent(spec);
  const S = theme.S;
  const palette = theme.PALETTE;
  const { ctx, canvas } = theme.newCanvas(width, height);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette.bg0);
  background.addColorStop(0.52, palette.bg1);
  background.addColorStop(1, palette.bg0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  theme.panel(ctx, padding, S(18), contentWidth, height - S(36), S(14), palette.accent);
  let y = S(60);

  theme.label(ctx, String(spec.chip || "JOHN TRAN") + "  /  " + String(spec.brand || global.config?.name_bot || "JOHN TRAN"), padding + S(20), y, {
    size: 11,
    color: palette.accent
  });
  y += S(44);

  ctx.font = theme.font(31, "JT-Display-Bold");
  const titleLines = wrapText(ctx, sanitize(spec.title || "Thông báo"), contentWidth - S(40));
  for (const line of titleLines) {
    theme.text(ctx, line, padding + S(20), y, {
      size: 31, family: "JT-Display-Bold", color: palette.ink, maxWidth: contentWidth - S(40)
    });
    y += S(39);
  }

  if (spec.subtitle) {
    y += S(4);
    ctx.font = theme.font(16, "JT");
    for (const line of wrapText(ctx, sanitize(spec.subtitle), contentWidth - S(40))) {
      theme.text(ctx, line, padding + S(20), y, {
        size: 16, color: palette.ink2, maxWidth: contentWidth - S(40)
      });
      y += S(25);
    }
  }

  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  for (const section of sections) {
    y += S(14);
    theme.panel(ctx, padding + S(16), y - S(12), contentWidth - S(32), S(35), S(8), "rgba(212,175,55,.32)");
    if (section.title) {
      theme.label(ctx, String(section.title), padding + S(29), y + S(10), { size: 10 });
      y += S(32);
    }
    const lines = (Array.isArray(section.lines) ? section.lines : [])
      .flatMap(line => wrapText(ctx, sanitize(line), contentWidth - S(70)));
    for (const line of lines) {
      theme.text(ctx, line, padding + S(32), y + S(17), {
        size: 14, color: palette.ink2, maxWidth: contentWidth - S(64)
      });
      y += S(23);
    }
    y += S(7);
  }

  if (spec.footer) {
    theme.text(ctx, sanitize(spec.footer), width - padding - S(18), height - S(28), {
      size: 10, family: "JT-Mono", color: palette.mute, align: "right", maxWidth: contentWidth - S(36)
    });
  }
  return canvas;
}

function renderCardToFile(spec = {}, filePath) {
  const canvas = renderCard(spec);
  const outputPath = filePath || path.join(os.tmpdir(), "jt_card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(outputPath, withMacWindow(canvas, spec.title || spec.chip || "JOHN TRAN").toBuffer("image/png"));
  return outputPath;
}

module.exports = { renderCard, renderCardToFile, sanitize, THEMES, _test: { measureContent, wrapText } };
