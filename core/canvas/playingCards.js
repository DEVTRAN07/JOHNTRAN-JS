"use strict";

const theme = require("./theme");

const SUITS = Object.freeze({
  b: { symbol: "♠", color: "#17211e", label: "BÍCH" },
  ch: { symbol: "♣", color: "#17211e", label: "CHUỒN" },
  r: { symbol: "♦", color: "#bd3442", label: "RÔ" },
  c: { symbol: "♥", color: "#bd3442", label: "CƠ" }
});

function rankText(rank) {
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" })[Number(rank)] || String(rank);
}

function drawLabel(ctx, value, x, y, scale, options = {}) {
  ctx.save();
  ctx.font = (options.weight || 900) + " " +
    Math.max(9, Math.round((options.size || 18) * scale)) + "px " +
    (options.family || "Arial, sans-serif");
  theme.drawMulticolorText(ctx, String(value ?? ""), x, y, {
    font: ctx.font,
    color: options.color || "#17211e",
    align: options.align || "left",
    baseline: options.baseline || "alphabetic",
    maxWidth: options.maxWidth,
    multicolor: options.multicolor !== false
  });
  ctx.restore();
}

function drawPlayingCard(ctx, card, x, y, width, height, scale = 1, options = {}) {
  if (!ctx || !card) return;
  const suit = SUITS[card.suit] || SUITS.b;
  const rank = rankText(card.rank);
  const compact = Boolean(options.small);
  const premium = Boolean(options.premium);
  const selected = Boolean(options.selected);
  const radius = Math.max(4, 9 * scale);

  ctx.save();
  ctx.shadowColor = selected ? "rgba(48,232,174,.45)" :
    premium ? "rgba(245,190,77,.42)" : "rgba(0,0,0,.30)";
  ctx.shadowBlur = (selected ? 13 : premium ? 10 : 6) * scale;
  ctx.shadowOffsetY = 3 * scale;
  theme.roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = premium ? "#fff9e9" : "#fffefa";
  ctx.fill();
  ctx.restore();

  theme.roundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = selected ? "#16b987" : premium ? "#c8922c" : "#d7ded6";
  ctx.lineWidth = (selected ? 3.2 : premium ? 2.5 : 1.35) * scale;
  ctx.stroke();

  // A quiet inner hairline makes the card face feel crisp without reducing contrast.
  theme.roundRect(ctx, x + 3 * scale, y + 3 * scale,
    Math.max(1, width - 6 * scale), Math.max(1, height - 6 * scale), radius * .72);
  ctx.strokeStyle = "rgba(30,55,43,.08)";
  ctx.lineWidth = 1 * scale;
  ctx.stroke();

  const rankSize = compact ? 27 : 33;
  const suitSize = compact ? 22 : 27;
  const centerSize = compact ? 43 : 55;
  drawLabel(ctx, rank, x + 8 * scale, y + 31 * scale, scale, {
    size: rankSize, color: suit.color
  });
  drawLabel(ctx, suit.symbol, x + 9 * scale, y + 54 * scale, scale, {
    size: suitSize, color: suit.color
  });

  // Center pip is deliberately large so the suit stays readable on a phone.
  drawLabel(ctx, suit.symbol, x + width / 2, y + height * .68, scale, {
    size: centerSize, color: suit.color, align: "center"
  });

  // The index stays in the visible left/bottom area even when neighboring cards overlap.
  if (Number.isInteger(options.index) && options.index > 0) {
    const badgeW = Math.min(27 * scale, width * .42);
    const badgeH = Math.min(23 * scale, height * .22);
    const badgeX = x + 5 * scale;
    const badgeY = y + height - badgeH - 5 * scale;
    theme.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6 * scale);
    ctx.fillStyle = premium ? "#8b5a12" : selected ? "#087a58" : "#153e31";
    ctx.fill();
    ctx.strokeStyle = premium ? "#eec46a" : "#6ed9b4";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    drawLabel(ctx, String(options.index), badgeX + badgeW / 2,
      badgeY + badgeH * .73, scale, {
        size: 13, color: "#fffdf4", align: "center"
      });
  }

  if (selected) {
    theme.roundRect(ctx, x + 3 * scale, y + 3 * scale,
      width - 6 * scale, height - 6 * scale, radius * .72);
    ctx.strokeStyle = "#12b982";
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  }
}

module.exports = { SUITS, rankText, drawPlayingCard };
