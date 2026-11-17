"use strict";

const theme = require("./theme");

function drawText(ctx, text, x, y, scale, options = {}) {
  const size = Math.max(9, Math.round((options.size || 18) * scale));
  ctx.save();
  ctx.font = (options.weight || 700) + " " + size + "px " + (options.family || "Arial, sans-serif");
  ctx.fillStyle = options.color || theme.PALETTE.ink;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "alphabetic";
  if (options.maxWidth) ctx.fillText(String(text ?? ""), x, y, options.maxWidth);
  else ctx.fillText(String(text ?? ""), x, y);
  ctx.restore();
}

function roundPanel(ctx, x, y, w, h, radius, fill, stroke) {
  theme.roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill || "rgba(3,24,19,.78)";
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function suitInfo(suit) {
  const map = {
    b: { symbol: "♠", color: "#22252a", name: "BÍCH" },
    ch: { symbol: "♣", color: "#22252a", name: "CHUỒN" },
    r: { symbol: "♦", color: "#d22f36", name: "RÔ" },
    c: { symbol: "♥", color: "#d22f36", name: "CƠ" }
  };
  return map[suit] || map.b;
}

function rankText(rank) {
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2" })[rank] || String(rank);
}

function drawPlayingCard(ctx, card, x, y, w, h, scale, options = {}) {
  const suit = suitInfo(card.suit);
  const rank = rankText(card.rank);
  ctx.save();
  theme.roundRect(ctx, x + 2 * scale, y + 4 * scale, w, h, 10 * scale);
  ctx.fillStyle = "rgba(0,0,0,.38)";
  ctx.fill();
  theme.roundRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = "#fff9e9";
  ctx.fill();
  ctx.strokeStyle = options.selected ? "#16e6a1" : "#d6c9a7";
  ctx.lineWidth = options.selected ? 3 * scale : 1 * scale;
  ctx.stroke();
  drawText(ctx, rank, x + 9 * scale, y + 26 * scale, scale, {
    size: options.small ? 15 : 19, weight: 900, color: suit.color
  });
  drawText(ctx, suit.symbol, x + 10 * scale, y + 47 * scale, scale, {
    size: options.small ? 16 : 20, weight: 800, color: suit.color
  });
  drawText(ctx, suit.symbol, x + w / 2, y + h * .70, scale, {
    size: options.small ? 30 : 37, weight: 800, color: suit.color, align: "center"
  });
  drawText(ctx, rank, x + w - 8 * scale, y + h - 8 * scale, scale, {
    size: options.small ? 15 : 18, weight: 900, color: suit.color, align: "right"
  });
  ctx.restore();
}

function renderTable(ctx, width, height, scale, data) {
  const room = data.room || {};
  const players = Array.isArray(room.players) ? room.players : [];
  const px = value => Math.round(value * scale);
  drawText(ctx, "JOHNTRAN  /  ROYAL GAME ROOM", px(58), px(52), scale, {
    size: 12, weight: 900, color: "#ffd34f"
  });
  drawText(ctx, "TIẾN LÊN MIỀN NAM", width / 2, px(113), scale, {
    size: 39, weight: 900, color: "#f8f2d9", align: "center"
  });
  drawText(ctx, "BÀN #" + String(room.id || "-----") + "   •   CƯỢC " +
    String(room.bet || 5000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "$   •   " +
    (room.mode === "demla" ? "ĐẾM LÁ" : "NHẤT NHÌ BA BÉT"),
    width / 2, px(148), scale, {
      size: 13, weight: 800, color: "#b5d8c9", align: "center"
    });
  if (room.status === "waiting") {
    roundPanel(ctx, width - px(170), px(28), px(112), px(42), px(12), "#087a3d", "#e7d77a");
    drawText(ctx, "◷ 60s", width - px(114), px(56), scale, {
      size: 15, weight: 900, color: "#fff6d4", align: "center"
    });
  }

  const margin = px(58);
  const gap = px(16);
  const panelY = px(196);
  const panelH = px(112);
  const panelW = (width - margin * 2 - gap * 3) / 4;
  for (let index = 0; index < 4; index += 1) {
    const item = players[index];
    const x = margin + index * (panelW + gap);
    const isTurn = item && item.uid === room.turnUid;
    roundPanel(ctx, x, panelY, panelW, panelH, px(13),
      isTurn ? "rgba(91,5,15,.94)" : "rgba(30,0,8,.58)",
      isTurn ? "#20e3a4" : "rgba(255,197,48,.35)");
    drawText(ctx, item ? (index + 1) + ". " + item.name : "CHỖ TRỐNG",
      x + px(14), panelY + px(33), scale, {
        size: 13, weight: 900, color: item ? "#f4edda" : "#82968c",
        maxWidth: panelW - px(28)
      });
    drawText(ctx, item ? (item.handCount == null ? "ĐANG CHỜ" : item.handCount + " LÁ CÒN LẠI") : "MỜI THAM GIA",
      x + px(14), panelY + px(63), scale, {
        size: 11, weight: 800, color: isTurn ? "#ffe17a" : "#a3b8ad"
      });
    if (isTurn) {
      drawText(ctx, "LƯỢT ĐÁNH", x + px(14), panelY + px(88), scale, {
        size: 10, weight: 900, color: "#f5d37e"
      });
    }
  }

  roundPanel(ctx, margin, px(340), width - margin * 2, px(250), px(18),
    "rgba(68,2,12,.82)", "rgba(255,197,48,.50)");
  drawText(ctx, "BÀI TRÊN BÀN", width / 2, px(383), scale, {
    size: 14, weight: 900, color: "#8de8c5", align: "center"
  });
  const lastPlay = room.lastPlay;
  if (lastPlay && Array.isArray(lastPlay.cards) && lastPlay.cards.length) {
    drawText(ctx, (lastPlay.name || "Người chơi") + " vừa đánh",
      width / 2, px(414), scale, {
        size: 13, weight: 800, color: "#f8efd8", align: "center"
      });
    const cards = lastPlay.cards.slice(0, 12);
    const cardW = px(70);
    const cardH = px(112);
    const cardGap = px(10);
    const total = cards.length * cardW + (cards.length - 1) * cardGap;
    const startX = (width - total) / 2;
    cards.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + cardGap), px(438), cardW, cardH, scale, { small: true }));
  } else {
    drawText(ctx, room.status === "waiting" ? "ĐANG CHỜ NGƯỜI CHƠI THAM GIA" : "CHƯA CÓ LÁ BÀI NÀO ĐƯỢC ĐÁNH",
      width / 2, px(478), scale, {
        size: 17, weight: 900, color: "#d8c99d", align: "center"
      });
    drawText(ctx, room.status === "waiting" ? "GỬI: join " + String(room.id || "-----") : "NGƯỜI CÓ 3♠ ĐI TRƯỚC",
      width / 2, px(512), scale, {
        size: 12, weight: 800, color: "#77b79c", align: "center"
      });
  }

  const footer = room.status === "waiting"
    ? "CHỦ PHÒNG BẤM START KHI CÓ TỪ 2 ĐẾN 4 NGƯỜI"
    : "BÀI RIÊNG ĐƯỢC GỬI QUA TIN NHẮN RIÊNG • NHÓM CHỈ HIỆN LƯỢT ĐÁNH";
  drawText(ctx, footer, width / 2, px(667), scale, {
    size: 11, weight: 900, color: "#ffd34f", align: "center"
  });
  drawText(ctx, "♠  ♥  ♦  ♣     JOHNTRAN • SÒNG BÀI HOÀNG GIA",
    width / 2, px(720), scale, {
      size: 10, weight: 800, color: "#8ba79a", align: "center"
    });
}

function renderHand(ctx, width, height, scale, data) {
  const room = data.room || {};
  const player = data.player || {};
  const hand = Array.isArray(data.hand) ? data.hand : [];
  const px = value => Math.round(value * scale);
  drawText(ctx, "JOHNTRAN  /  PRIVATE HAND", px(58), px(52), scale, {
    size: 12, weight: 900, color: "#ffd34f"
  });
  drawText(ctx, "BÀI RIÊNG CỦA BẠN", width / 2, px(112), scale, {
    size: 34, weight: 900, color: "#fff1ce", align: "center"
  });
  drawText(ctx, (player.name || "Người chơi") + "   •   BÀN #" + String(room.id || "-----") +
    "   •   CÒN " + hand.length + " LÁ",
    width / 2, px(151), scale, {
      size: 14, weight: 800, color: "#a9d5c1", align: "center"
    });
  roundPanel(ctx, px(48), px(190), width - px(96), px(270), px(20),
    "rgba(62,2,12,.88)", "rgba(255,203,54,.72)");
  if (!hand.length) {
    drawText(ctx, "BẠN ĐÃ HẾT BÀI!", width / 2, px(337), scale, {
      size: 30, weight: 900, color: "#2ce8ae", align: "center"
    });
  } else {
    const cardW = px(65);
    const cardH = px(128);
    const gap = px(9);
    const total = hand.length * cardW + Math.max(0, hand.length - 1) * gap;
    const startX = Math.max(px(58), (width - total) / 2);
    const y = hand.length > 10 ? px(248) : px(260);
    hand.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + gap), y, cardW, cardH, scale, { small: true }));
  }

  const commandY = px(514);
  roundPanel(ctx, px(48), px(492), width - px(96), px(170), px(16),
    "rgba(27,0,7,.58)", "rgba(205,175,110,.30)");
  drawText(ctx, data.isTurn ? "🎯 ĐẾN LƯỢT BẠN" : "🔒 BÀI CỦA RIÊNG BẠN",
    px(78), commandY + px(18), scale, {
      size: 16, weight: 900, color: data.isTurn ? "#ffd34f" : "#e7d4a9"
    });
  drawText(ctx, "Đánh lẻ: 4r     •     Đôi: doi 4     •     Sảnh: sanh 4567",
    px(78), commandY + px(58), scale, {
      size: 13, weight: 800, color: "#f4ead1"
    });
  drawText(ctx, "Tứ quý: tuquy 4     •     Bỏ lượt: bo / pass",
    px(78), commandY + px(92), scale, {
      size: 13, weight: 800, color: "#c0d9ca"
    });
  drawText(ctx, "BÍCH (b)  •  CHUỒN (ch)  •  RÔ (r)  •  CƠ (c)",
    px(78), commandY + px(128), scale, {
      size: 11, weight: 900, color: "#ffd34f"
    });
  drawText(ctx, "CƯỢC " + String(room.bet || 5000) + "$  •  NHẤT NHÌ BA BÉT",
    width / 2, px(710), scale, {
      size: 10, weight: 900, color: "#8ba79a", align: "center"
    });
}

function renderTlmn(data = {}) {
  theme.initFonts();
  theme.ensureTheme();
  const width = theme.WIDTH;
  const scale = width / 1080;
  const px = value => Math.round(value * scale);
  const height = px(780);
  const { canvas, ctx } = theme.newCanvas(width, height);
  theme.paintBackground(ctx, width, height);

  // Royal red felt table with a dark burgundy vignette, matching the supplied
  // Tiến Lên reference artwork rather than the bot's default green theme.
  const felt = ctx.createRadialGradient(width / 2, px(350), px(35), width / 2, px(390), px(620));
  felt.addColorStop(0, "#a30d16");
  felt.addColorStop(0.48, "#78060d");
  felt.addColorStop(0.82, "#43030a");
  felt.addColorStop(1, "#120208");
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, width, height);
  const goldGlow = ctx.createRadialGradient(width / 2, px(370), px(20), width / 2, px(390), px(440));
  goldGlow.addColorStop(0, "rgba(255,190,45,.10)");
  goldGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = goldGlow;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,205,65,.42)";
  ctx.lineWidth = px(3);
  theme.roundRect(ctx, px(22), px(22), width - px(44), height - px(44), px(24));
  ctx.stroke();

  if (data.view === "hand") renderHand(ctx, width, height, scale, data);
  else renderTable(ctx, width, height, scale, data);

  return theme.save(canvas, "tlmn");
}

module.exports = { renderTlmn, _test: { suitInfo, rankText } };
