"use strict";

const theme = require("./theme");

function text(ctx, value, x, y, scale, options = {}) {
  ctx.save();
  ctx.font = (options.weight || 800) + " " +
    Math.max(9, Math.round((options.size || 18) * scale)) + "px " +
    (options.family || "Arial, sans-serif");
  ctx.fillStyle = options.color || theme.PALETTE.ink;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  if (options.maxWidth) ctx.fillText(String(value ?? ""), x, y, options.maxWidth);
  else ctx.fillText(String(value ?? ""), x, y);
  ctx.restore();
}

function panel(ctx, x, y, width, height, radius, fill, stroke) {
  theme.roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawCard(ctx, card, x, y, width, height, scale, index, isAdmin) {
  const rank = ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" })[card.rank] || String(card.rank);
  const suit = ({
    b: { symbol: "♠", color: "#25282d" },
    ch: { symbol: "♣", color: "#25282d" },
    r: { symbol: "♦", color: "#d52f3c" },
    c: { symbol: "♥", color: "#d52f3c" }
  })[card.suit] || { symbol: "♠", color: "#25282d" };

  ctx.save();
  ctx.shadowColor = isAdmin ? "rgba(255,209,100,.65)" : "rgba(0,0,0,.42)";
  ctx.shadowBlur = (isAdmin ? 12 : 7) * scale;
  theme.roundRect(ctx, x, y, width, height, 11 * scale);
  ctx.fillStyle = "#fff9e9";
  ctx.fill();
  ctx.restore();

  theme.roundRect(ctx, x, y, width, height, 11 * scale);
  ctx.strokeStyle = isAdmin ? "#d79b28" : "#d8cbaa";
  ctx.lineWidth = isAdmin ? 2.6 * scale : 1.2 * scale;
  ctx.stroke();
  text(ctx, rank, x + 8 * scale, y + 25 * scale, scale, {
    size: 17, weight: 900, color: suit.color
  });
  text(ctx, suit.symbol, x + 9 * scale, y + 47 * scale, scale, {
    size: 18, weight: 900, color: suit.color
  });
  text(ctx, suit.symbol, x + width / 2, y + height * .70, scale, {
    size: 33, weight: 900, color: suit.color, align: "center"
  });
  text(ctx, rank, x + width - 8 * scale, y + height - 9 * scale, scale, {
    size: 16, weight: 900, color: suit.color, align: "right"
  });
  panel(ctx, x + width - 27 * scale, y + 5 * scale, 19 * scale, 19 * scale,
    6 * scale, isAdmin ? "#86570d" : "#07584f", isAdmin ? "#ffd56d" : "#56e5c5");
  text(ctx, String(index), x + width - 17.5 * scale, y + 19 * scale, scale, {
    size: 10, weight: 900, color: "#fff", align: "center"
  });
}

function renderSam(data = {}) {
  theme.initFonts();
  theme.ensureTheme();
  const width = theme.WIDTH;
  const scale = width / 1080;
  const px = value => Math.round(value * scale);
  const height = px(650);
  const { canvas, ctx } = theme.newCanvas(width, height);
  theme.paintBackground(ctx, width, height);

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#071723");
  bg.addColorStop(.54, "#092c31");
  bg.addColorStop(1, "#061017");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  theme.roundRect(ctx, px(22), px(22), width - px(44), height - px(44), px(24));
  ctx.strokeStyle = "rgba(93,225,198,.55)";
  ctx.lineWidth = px(2.5);
  ctx.stroke();

  const room = data.room || {};
  const player = data.player || {};
  const hand = Array.isArray(data.hand) ? data.hand : [];
  const admin = Boolean(data.isAdmin);

  theme.label(ctx, "JOHNTRAN  /  CARD TABLE", px(58), px(58), {
    size: 12, color: "#78e8d0"
  });
  text(ctx, "SÂM LỐC", width / 2, px(116), scale, {
    size: 38, weight: 900, color: "#f5efd9", align: "center"
  });
  text(ctx, (player.name || "Người chơi") + "   •   BÀN #" +
    String(room.id || "-----") + "   •   " + hand.length + " LÁ",
    width / 2, px(154), scale, {
      size: 14, weight: 800, color: "#a9d5c9", align: "center"
    });

  panel(ctx, px(42), px(188), width - px(84), px(244), px(20),
    "rgba(2,14,20,.72)", admin ? "rgba(255,213,109,.88)" : "rgba(91,220,198,.46)");

  if (!hand.length) {
    text(ctx, "BẠN ĐÃ HẾT BÀI!", width / 2, px(326), scale, {
      size: 30, weight: 900, color: "#5ce3b2", align: "center"
    });
  } else {
    const cardWidth = px(82);
    const cardHeight = px(154);
    const gap = hand.length > 9 ? px(-4) : px(8);
    const total = hand.length * cardWidth + (hand.length - 1) * gap;
    const startX = Math.max(px(54), (width - total) / 2);
    hand.forEach((card, index) => drawCard(
      ctx, card, startX + index * (cardWidth + gap), px(232),
      cardWidth, cardHeight, scale, index + 1, admin
    ));
  }

  panel(ctx, px(42), px(455), width - px(84), px(150), px(16),
    "rgba(2,14,20,.62)", "rgba(90,220,196,.28)");
  text(ctx, data.isTurn ? "🎯 ĐẾN LƯỢT BẠN" : "🔒 BÀI RIÊNG CỦA BẠN",
    px(70), px(493), scale, {
      size: 17, weight: 900, color: data.isTurn ? "#ffda78" : "#d8e9df"
    });
  text(ctx, "Lẻ: 3b  •  Đôi: doi 7  •  Sám: sam 9  •  Tứ quý: tuquy 5",
    px(70), px(532), scale, {
      size: 13, weight: 800, color: "#f4ead2"
    });
  text(ctx, "Sảnh: sanh 345  •  Chọn lá: chon 1,2  •  Bỏ lượt: pass",
    px(70), px(564), scale, {
      size: 13, weight: 800, color: "#73e8cf"
    });
  text(ctx, "Báo Sâm: baosam  •  3♠ mở đầu  •  Bích b / Chuồn ch / Rô r / Cơ c",
    px(70), px(592), scale, {
      size: 11, weight: 800, color: "#d2c69e"
    });

  return theme.save(canvas, "sam");
}

module.exports = { renderSam, _test: { drawCard } };
