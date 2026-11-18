"use strict";

const theme = require("./theme");
const avatarCache = require("./avatarCache");
const { drawPlayingCard: renderCardFace } = require("./playingCards");

function drawText(ctx, text, x, y, scale, options = {}) {
  const size = Math.max(9, Math.round((options.size || 18) * scale));
  ctx.save();
  ctx.font = (options.weight || 700) + " " + size + "px " + (options.family || "Arial, sans-serif");
  const requestedColor = options.color || theme.PALETTE.ink;
  const value = String(text ?? "");
  const words = value.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  theme.drawMulticolorText(ctx, value, x, y, {
    font: ctx.font,
    color: requestedColor,
    align: options.align || "left",
    baseline: options.baseline || "alphabetic",
    maxWidth: options.maxWidth,
    multicolor: words.length > 1 || words.some(word => theme.splitGraphemes(word).length > 1)
  });
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
  return renderCardFace(ctx, card, x, y, w, h, scale, options);
}


function drawSeat(ctx, item, x, y, w, h, scale, index, isTurn) {
  const px = value => Math.round(value * scale);
  const p = { ...theme.PALETTE, ...theme.getCardPalette() };
  const active = Boolean(item && isTurn);
  roundPanel(ctx, x, y, w, h, px(16),
    active ? "rgba(17,74,115,.96)" : "rgba(8,22,39,.94)",
    active ? p.accent : p.cardBorder);

  const avatarX = x + px(40);
  const avatarY = y + h / 2;
  const avatarRadius = px(25);
  const avatarImage = item && !item.ai ? avatarCache.getAvatar(item.avatarUrl) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();
  if (avatarImage) {
    ctx.drawImage(avatarImage, avatarX - avatarRadius, avatarY - avatarRadius,
      avatarRadius * 2, avatarRadius * 2);
  } else {
    ctx.fillStyle = active ? "#14577f" : "#102b4b";
    ctx.fillRect(avatarX - avatarRadius, avatarY - avatarRadius,
      avatarRadius * 2, avatarRadius * 2);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.lineWidth = px(active ? 3.5 : 2);
  ctx.strokeStyle = active ? p.accent : p.border;
  ctx.stroke();
  ctx.restore();

  if (!avatarImage || item?.ai) {
    drawText(ctx, item
      ? (item.ai ? "AI" : String(item.name || "P").trim().slice(0, 1).toUpperCase())
      : "+",
      avatarX, avatarY + px(8), scale, {
        size: 22, weight: 900, color: p.ink, align: "center"
      });
  }

  if (!item) {
    drawText(ctx, "GHẾ TRỐNG", x + px(78), y + h / 2 + px(5), scale, {
      size: 13, weight: 900, color: p.mute
    });
    drawText(ctx, "ĐANG MỞ", x + w - px(16), y + h / 2 + px(5), scale, {
      size: 10, weight: 800, color: p.accent2, align: "right"
    });
    return;
  }

  const name = String(item.name || "Người chơi").replace(/[\r\n\t]+/g, " ");
  const compact = w < px(260);
  const nameWidth = Math.max(px(68), w - px(compact ? 104 : 142));
  drawText(ctx, name,
    x + px(78), y + px(36), scale, {
      size: 16, weight: 900, color: p.ink, maxWidth: nameWidth
    });
  const count = item.handCount == null ? "ĐANG CHỜ" : item.handCount + " LÁ";
  drawText(ctx, count, x + px(79), y + px(68), scale, {
    size: 12, weight: 900, color: active ? p.accent2 : "#b9d1c5"
  });

  if (active && compact) {
    drawText(ctx, "▶ LƯỢT", x + w - px(12), y + px(68), scale, {
      size: 10, weight: 900, color: p.green, align: "right"
    });
  } else if (active) {
    roundPanel(ctx, x + w - px(94), y + px(22), px(76), px(34), px(10),
      "#0d4d78", p.accent);
    drawText(ctx, "LƯỢT", x + w - px(56), y + px(45), scale, {
      size: 11, weight: 900, color: p.ink, align: "center"
    });
  } else if (item.place > 0) {
    drawText(ctx, "HẠNG " + item.place, x + w - px(15), y + px(48), scale, {
      size: 10, weight: 900, color: p.accent2, align: "right"
    });
  } else {
    drawText(ctx, item.ai ? "ĐỐI THỦ AI" : "NGƯỜI CHƠI " + (index + 1),
      x + w - px(15), y + px(48), scale, {
        size: 9, weight: 800, color: p.muted, align: "right"
      });
  }
}

function seatLayout(playerCount) {
  if (Number(playerCount) >= 4) {
    return [
      { x: 370, y: 174, w: 340, h: 92 },
      { x: 22, y: 378, w: 230, h: 100 },
      { x: 370, y: 568, w: 340, h: 92 },
      { x: 828, y: 378, w: 230, h: 100 }
    ];
  }
  if (Number(playerCount) === 3) {
    return [
      { x: 370, y: 174, w: 340, h: 92 },
      { x: 105, y: 568, w: 320, h: 92 },
      { x: 655, y: 568, w: 320, h: 92 }
    ];
  }
  return [
    { x: 370, y: 174, w: 340, h: 92 },
    { x: 370, y: 568, w: 340, h: 92 }
  ];
}

function renderTable(ctx, width, height, scale, data) {
  const p = { ...theme.PALETTE, ...theme.getCardPalette() };
  const room = data.room || {};
  const players = Array.isArray(room.players) ? room.players : [];
  const px = value => Math.round(value * scale);

  drawText(ctx, "JOHNTRAN  /  GAME TABLE", px(58), px(52), scale, {
    size: 12, weight: 900, color: p.accent
  });
  drawText(ctx, "TIẾN LÊN MIỀN NAM", width / 2, px(107), scale, {
    size: 36, weight: 900, color: p.ink, align: "center"
  });
  drawText(ctx, "BÀN #" + String(room.id || "-----") + "   •   CƯỢC " +
    String(room.bet || 5000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "$   •   " +
    (room.practice ? "LUYỆN TẬP VS 3 AI" :
      room.mode === "demla" ? "ĐẾM LÁ" : "NHẤT NHÌ BA BÉT"),
    width / 2, px(145), scale, {
      size: 13, weight: 800, color: p.ink2, align: "center"
    });

  const positions = seatLayout(players.length);
  positions.forEach((position, index) => {
    const item = players[index] || null;
    drawSeat(ctx, item, px(position.x), px(position.y), px(position.w),
      px(position.h), scale, index, Boolean(item && item.uid === room.turnUid));
  });

  const tableX = players.length >= 4 ? px(254) : px(174);
  const tableY = px(304);
  const tableW = width - tableX * 2;
  const tableH = px(246);

  // Midnight glass playing surface: classic card faces remain untouched.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2 + px(5),
    tableW * .49, tableH * .50, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.48)";
  ctx.fill();
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = px(6);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2 + px(5),
    tableW * .47, tableH * .465, 0, 0, Math.PI * 2);
  const felt = ctx.createRadialGradient(width / 2, tableY + px(42), px(20),
    width / 2, tableY + tableH / 2, tableW * .60);
  felt.addColorStop(0, p.panel[0]);
  felt.addColorStop(.58, p.panel[1]);
  felt.addColorStop(1, p.background[0]);
  ctx.fillStyle = felt;
  ctx.fill();
  ctx.strokeStyle = p.border;
  ctx.lineWidth = px(1.6);
  ctx.stroke();
  ctx.restore();

  roundPanel(ctx, width / 2 - px(75), tableY + px(13), px(150), px(28),
    px(10), "rgba(5,15,29,.78)", p.infoBorder);
  drawText(ctx, "BÀI TRÊN BÀN", width / 2, tableY + px(33), scale, {
    size: 12, weight: 900, color: p.accent2, align: "center"
  });

  const lastPlay = room.lastPlay;
  if (lastPlay && Array.isArray(lastPlay.cards) && lastPlay.cards.length) {
    drawText(ctx, (lastPlay.name || "Người chơi") + " VỪA ĐÁNH",
      width / 2, tableY + px(65), scale, {
        size: 12, weight: 900, color: p.ink, align: "center"
      });
    const cards = lastPlay.cards.slice(0, 13);
    const twoRows = cards.length > 8;
    const columns = twoRows ? Math.ceil(cards.length / 2) : cards.length;
    const cardGap = px(5);
    const available = tableW - px(62);
    const cardW = Math.min(px(twoRows ? 58 : 66),
      Math.floor((available - cardGap * Math.max(0, columns - 1)) / Math.max(1, columns)));
    const cardH = px(twoRows ? 68 : 105);
    const total = columns * cardW + Math.max(0, columns - 1) * cardGap;
    const startX = (width - total) / 2;
    cards.forEach((card, index) => {
      const row = twoRows && index >= columns ? 1 : 0;
      const column = twoRows ? index % columns : index;
      const rowCount = twoRows && row === 1 ? cards.length - columns : columns;
      const rowTotal = rowCount * cardW + Math.max(0, rowCount - 1) * cardGap;
      const rowStart = (width - rowTotal) / 2;
      drawPlayingCard(ctx, card,
        rowStart + column * (cardW + cardGap),
        tableY + px(twoRows ? 77 + row * 74 : 80),
        cardW, cardH, scale, { small: true });
    });
    const combo = room.currentCombo;
    if (combo) {
      const label = String(combo.type || "BÀI").toUpperCase()
        .replace("PAIRRUN", "ĐÔI THÔNG")
        .replace("FOURKIND", "TỨ QUÝ")
        .replace("STRAIGHT", "SẢNH")
        .replace("SINGLE", "LẺ")
        .replace("PAIR", "ĐÔI")
        .replace("TRIPLE", "SÁM CÔ");
      drawText(ctx, label + (combo.type === "pairRun" ? " " + combo.length + " ĐÔI" : ""),
        width / 2, tableY + tableH - px(10), scale, {
          size: 11, weight: 900, color: p.accent2, align: "center"
        });
    }
  } else {
    const title = room.status === "waiting"
      ? "MỜI NGƯỜI CHƠI THAM GIA"
      : room.playedCount === 0
        ? (room.previousWinnerUid ? "NGƯỜI THẮNG VÁN TRƯỚC ĐI ĐẦU" : "CHỜ NƯỚC ĐÁNH ĐẦU TIÊN")
        : "VÒNG ĐÁNH ĐÃ ĐƯỢC DỌN";
    drawText(ctx, title, width / 2, tableY + px(123), scale, {
      size: 16, weight: 900, color: p.ink, align: "center"
    });
    drawText(ctx, room.status === "waiting"
      ? "NHẬP JOIN " + String(room.id || "-----") + " ĐỂ VÀO BÀN"
      : "NGƯỜI ĐẾN LƯỢT SẼ MỞ VÒNG MỚI",
      width / 2, tableY + px(155), scale, {
        size: 11, weight: 800, color: p.ink2, align: "center"
      });
  }

  if (room.status === "waiting") {
    roundPanel(ctx, width - px(172), px(28), px(112), px(40),
      px(12), "#104a75", p.accent);
    drawText(ctx, "●  PHÒNG CHỜ", width - px(116), px(54), scale, {
      size: 10, weight: 900, color: p.ink, align: "center"
    });
  } else if (room.turnUid) {
    const current = players.find(item => item.uid === room.turnUid);
    roundPanel(ctx, width / 2 - px(235), px(684), px(470), px(38),
      px(12), p.infoFill, p.infoBorder);
    drawText(ctx, "ĐẾN LƯỢT: " + String(current?.name || "NGƯỜI CHƠI").toUpperCase() + "  •  60 GIÂY",
      width / 2, px(709), scale, {
        size: 13, weight: 900, color: p.ink, align: "center"
      });
  }

  const footer = room.practice
    ? "LUYỆN TẬP VS 3 AI  •  KHÔNG CƯỢC XU  •  BÀI RIÊNG ĐƯỢC GỬI QUA TIN NHẮN"
    : room.status === "waiting"
      ? "CHỦ PHÒNG GÕ START KHI ĐỦ NGƯỜI  •  TỪ 2 ĐẾN 4 NGƯỜI"
      : "BÀI RIÊNG QUA INBOX  •  NHÓM CHỈ HIỆN LÁ BÀI VỪA ĐÁNH";
  drawText(ctx, footer, width / 2, px(752), scale, {
    size: 10, weight: 900, color: p.muted, align: "center"
  });
}

function renderHand(ctx, width, height, scale, data) {
  const p = { ...theme.PALETTE, ...theme.getCardPalette() };
  const room = data.room || {};
  const player = data.player || {};
  const hand = Array.isArray(data.hand) ? data.hand : [];
  const px = value => Math.round(value * scale);
  const premium = Boolean(data.isAdmin);

  drawText(ctx, premium ? "JOHNTRAN  /  ADMIN ROYAL HAND" : "JOHNTRAN  /  PRIVATE HAND",
    px(58), px(52), scale, {
      size: 12, weight: 900, color: premium ? "#f5d58b" : p.accent
    });
  drawText(ctx, premium ? "BÀI HOÀNG GIA" : "BÀI CỦA BẠN",
    width / 2, px(108), scale, {
      size: 35, weight: 900, color: premium ? "#ffe4a0" : p.ink, align: "center"
    });
  drawText(ctx, (player.name || "Người chơi") + "   •   BÀN #" +
    String(room.id || "-----") + "   •   CÒN " + hand.length + " LÁ",
    width / 2, px(146), scale, {
      size: 14, weight: 800, color: "#c4ded0", align: "center"
    });

  roundPanel(ctx, px(36), px(177), width - px(72), px(309),
    px(21), p.card[1],
    premium ? p.border : p.cardBorder);

  if (!hand.length) {
    drawText(ctx, "BẠN ĐÃ HẾT BÀI!", width / 2, px(337), scale, {
      size: 30, weight: 900, color: p.green, align: "center"
    });
  } else {
    const cardW = px(82);
    const cardH = px(170);
    const gap = hand.length > 10 ? px(-12) : hand.length > 7 ? px(-4) : px(5);
    const total = hand.length * cardW + Math.max(0, hand.length - 1) * gap;
    const startX = Math.max(px(49), (width - total) / 2);
    const y = px(235);
    hand.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + gap), y, cardW, cardH, scale, {
        small: false, premium, index: index + 1
      }));
  }

  roundPanel(ctx, px(42), px(511), width - px(84), px(178),
    px(18), p.card[1], p.cardBorder);
  const activeColor = data.isTurn ? p.green : p.accent2;
  drawText(ctx, data.isTurn ? "●  ĐẾN LƯỢT BẠN" : "🔒  BÀI RIÊNG CỦA BẠN",
    px(70), px(548), scale, {
      size: 17, weight: 900, color: activeColor
    });
  drawText(ctx, "ĐÁNH  •  Lẻ: 4r   |   Đôi: doi 4   |   Sám: sam 7   |   Sảnh: sanh 345",
    px(70), px(582), scale, {
      size: 13, weight: 900, color: p.ink
    });
  drawText(ctx, "CHỌN  •  chon 1,2   |   Gợi ý: goiy   |   Tự đánh: auto",
    px(70), px(616), scale, {
      size: 13, weight: 900, color: p.green
    });
  drawText(ctx, "HÀNG  •  tuquy 4   |   Đôi thông: 3dt / 4dt   |   Bỏ lượt: bo",
    px(70), px(649), scale, {
      size: 12, weight: 800, color: p.ink2
    });
  drawText(ctx, "SỐ TRÊN LÁ = THỨ TỰ CHỌN  •  BÍCH (b)  CHUỒN (ch)  RÔ (r)  CƠ (c)",
    width / 2, px(676), scale, {
      size: 10, weight: 900, color: p.muted, align: "center"
    });
  drawText(ctx, room.practice
    ? "LUYỆN TẬP VS AI  •  KHÔNG TRỪ XU"
    : "CƯỢC " + String(room.bet || 5000) + "$  •  " + (room.mode === "demla" ? "ĐẾM LÁ" : "NHẤT NHÌ BA BÉT"),
    width / 2, px(744), scale, {
      size: 10, weight: 900, color: premium ? p.accent2 : p.muted, align: "center"
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

  if (data.view === "hand") renderHand(ctx, width, height, scale, data);
  else renderTable(ctx, width, height, scale, data);
  return theme.save(canvas, "tlmn");
}

module.exports = {
  renderTlmn,
  _test: { suitInfo, rankText, seatLayout, drawPlayingCard }
};
