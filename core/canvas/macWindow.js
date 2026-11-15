"use strict";

const { createCanvas } = require("canvas");
const menuPalette = require("./menuPalette");

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function withMacWindow(content, title = "JOHN TRAN") {
  const palette = menuPalette.getPalette();
  const scale = content.width / 750;
  const toolbarHeight = Math.round(44 * scale);
  const inset = Math.round(12 * scale);
  const contentWidth = content.width - inset * 2;
  const contentHeight = Math.round(content.height * contentWidth / content.width);
  const radius = Math.round(18 * scale);
  const canvas = createCanvas(content.width, contentHeight + toolbarHeight + inset * 2);
  const ctx = canvas.getContext("2d");

  try {
    ctx.antialias = "best";
    ctx.quality = "best";
    ctx.patternQuality = "best";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  } catch { /* optional canvas quality flags */ }

  roundedRect(ctx, 0.5, 0.5, canvas.width - 1, canvas.height - 1, radius);
  ctx.save();
  ctx.clip();

  const outer = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  outer.addColorStop(0, palette.background[0]);
  outer.addColorStop(0.55, palette.panel[0]);
  outer.addColorStop(1, palette.background[3]);
  ctx.fillStyle = outer;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cardX = inset - Math.max(1, Math.round(2 * scale));
  const cardY = toolbarHeight + inset - Math.max(1, Math.round(2 * scale));
  const cardWidth = contentWidth + Math.max(2, Math.round(4 * scale));
  const cardHeight = contentHeight + Math.max(2, Math.round(4 * scale));
  roundedRect(ctx, cardX, cardY, cardWidth, cardHeight, Math.round(14 * scale));
  ctx.fillStyle = "#08080a";
  ctx.fill();

  roundedRect(ctx, inset, toolbarHeight + inset, contentWidth, contentHeight, Math.round(11 * scale));
  ctx.save();
  ctx.clip();
  ctx.drawImage(content, inset, toolbarHeight + inset, contentWidth, contentHeight);
  ctx.restore();

  const toolbar = ctx.createLinearGradient(0, 0, 0, toolbarHeight);
  toolbar.addColorStop(0, palette.footer[0]);
  toolbar.addColorStop(1, palette.footer[1]);
  ctx.fillStyle = toolbar;
  ctx.fillRect(0, 0, canvas.width, toolbarHeight);
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, toolbarHeight - Math.max(1, Math.round(scale)), canvas.width, Math.max(1, Math.round(scale)));
  ctx.globalAlpha = 1;

  const dotColors = ["#ff5f57", "#febc2e", "#28c840"];
  const dotRadius = 5.5 * scale;
  const firstDotX = 20 * scale;
  const dotY = toolbarHeight / 2;
  for (let i = 0; i < dotColors.length; i++) {
    const x = firstDotX + i * 19 * scale;
    ctx.beginPath();
    ctx.arc(x, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotColors[i];
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.18)";
    ctx.lineWidth = Math.max(1, scale);
    ctx.stroke();
  }

  ctx.font = "600 " + Math.round(13 * scale) + "px Arial";
  ctx.fillStyle = "#f6f2e7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(title || "JOHN TRAN").slice(0, 48), canvas.width / 2, dotY);
  ctx.restore();

  ctx.strokeStyle = palette.border;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, scale);
  roundedRect(ctx, 0.5, 0.5, canvas.width - 1, canvas.height - 1, radius);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return canvas;
}

module.exports = { withMacWindow };
