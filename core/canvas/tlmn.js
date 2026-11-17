"use strict";

const theme = require("./theme");
const avatarCache = require("./avatarCache");

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
  const premium = Boolean(options.premium);
  ctx.save();
  if (premium) {
    ctx.shadowColor = "rgba(255, 211, 98, .72)";
    ctx.shadowBlur = 10 * scale;
  }
  theme.roundRect(ctx, x + 2 * scale, y + 4 * scale, w, h, 10 * scale);
  ctx.fillStyle = "rgba(0,0,0,.38)";
  ctx.fill();
  theme.roundRect(ctx, x, y, w, h, 10 * scale);
  ctx.fillStyle = premium ? "#fff5d9" : "#fff9e9";
  ctx.fill();
  ctx.strokeStyle = options.selected ? "#16e6a1" : premium ? "#d79b28" : "#d6c9a7";
  ctx.lineWidth = options.selected ? 3 * scale : premium ? 2.8 * scale : 1 * scale;
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
  if (Number.isInteger(options.index) && options.index > 0) {
    roundPanel(ctx, x + w - 34 * scale, y + 5 * scale,
      18 * scale, 18 * scale, 6 * scale,
      premium ? "#8c5b0c" : "#07574f",
      premium ? "#ffd875" : "#55e5c4");
    drawText(ctx, String(options.index), x + w - 25 * scale,
      y + 18 * scale, scale, {
        size: 10, weight: 900, color: "#fff9e9", align: "center"
      });
  }
  ctx.restore();
}

function drawSeat(ctx, item, x, y, w, h, scale, index, isTurn) {
  const px = value => Math.round(value * scale);
  const active = Boolean(item && isTurn);
  roundPanel(ctx, x, y, w, h, px(16),
    active ? "rgba(73,7,16,.97)" : "rgba(24,2,8,.88)",
    active ? "#34e6b0" : "rgba(255,205,92,.52)");

  const avatarX = x + px(42);
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
    ctx.fillStyle = active ? "#164d3c" : "#3e1a20";
    ctx.fillRect(avatarX - avatarRadius, avatarY - avatarRadius,
      avatarRadius * 2, avatarRadius * 2);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  ctx.lineWidth = px(active ? 3.5 : 2);
  ctx.strokeStyle = active ? "#44edba" : "#d5b66e";
  ctx.stroke();
  ctx.restore();
  if (!avatarImage || item?.ai) {
    drawText(ctx, item
      ? (item.ai ? "AI" : String(item.name || "P").trim().slice(0, 1).toUpperCase())
      : "+",
      avatarX, avatarY + px(8), scale, {
        size: 22, weight: 900, color: "#fff1ce", align: "center"
      });
  }

  if (!item) {
    drawText(ctx, "GHẾ TRỐNG", x + px(78), y + h / 2 + px(5), scale, {
      size: 13, weight: 900, color: "#91a49a"
    });
    drawText(ctx, "ĐANG MỞ", x + w - px(16), y + h / 2 + px(5), scale, {
      size: 10, weight: 800, color: "#c6a76d", align: "right"
    });
    return;
  }

  const name = String(item.name || "Người chơi");
  const compact = w < px(260);
  const nameWidth = Math.max(px(68), w - px(compact ? 108 : 150));
  drawText(ctx, name.length > 22 ? name.slice(0, 20) + "…" : name,
    x + px(80), y + px(37), scale, {
      size: 15, weight: 900, color: "#fff3dc", maxWidth: nameWidth
    });
  const count = item.handCount == null ? "ĐANG CHỜ" : item.handCount + " LÁ";
  drawText(ctx, count, x + px(80), y + px(68), scale, {
    size: 11, weight: 800, color: active ? "#ffe17d" : "#b7c7bd"
  });
  if (active && compact) {
    drawText(ctx, "▶ ĐẾN LƯỢT", x + w - px(14), y + px(68), scale, {
      size: 11, weight: 900, color: "#43e8b5", align: "right"
    });
  } else if (active) {
    roundPanel(ctx, x + w - px(102), y + px(22), px(84), px(34), px(10),
      "#08764f", "#43e8b5");
    drawText(ctx, "LƯỢT", x + w - px(60), y + px(45), scale, {
      size: 10, weight: 900, color: "#fff6dc", align: "center"
    });
  } else if (item.place > 0) {
    drawText(ctx, "HẠNG " + item.place, x + w - px(16), y + px(48), scale, {
      size: 10, weight: 900, color: "#d9bc79", align: "right"
    });
  } else {
    drawText(ctx, "NGƯỜI CHƠI " + (index + 1), x + w - px(16), y + px(48), scale, {
      size: 9, weight: 800, color: "#9eaa9e", align: "right"
    });
  }
}

function seatLayout(playerCount) {
  if (Number(playerCount) >= 4) {
    return [
      { x: 370, y: 174, w: 340, h: 92 },
      { x: 22, y: 378, w: 230, h: 100 },
      { x: 828, y: 378, w: 230, h: 100 },
      { x: 370, y: 568, w: 340, h: 92 }
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
  const room = data.room || {};
  const players = Array.isArray(room.players) ? room.players : [];
  const px = value => Math.round(value * scale);

  drawText(ctx, "JOHNTRAN  /  ROYAL GAME ROOM", px(58), px(52), scale, {
    size: 12, weight: 900, color: "#ffd34f"
  });
  drawText(ctx, "TIẾN LÊN MIỀN NAM", width / 2, px(108), scale, {
    size: 37, weight: 900, color: "#fff3d8", align: "center"
  });
  drawText(ctx, "BÀN #" + String(room.id || "-----") + "   •   CƯỢC " +
    String(room.bet || 5000).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "$   •   " +
    (room.practice ? "LUYỆN TẬP VS 3 AI" :
      room.mode === "demla" ? "ĐẾM LÁ" : "NHẤT NHÌ BA BÉT"),
    width / 2, px(145), scale, {
      size: 13, weight: 800, color: "#c4dbc9", align: "center"
    });

  const positions = seatLayout(players.length);

  positions.forEach((position, index) => {
    const item = players[index] || null;
    drawSeat(ctx, item, px(position.x), px(position.y), px(position.w),
      px(position.h), scale, index, Boolean(item && item.uid === room.turnUid));
  });

  const tableX = players.length >= 4 ? px(260) : px(180);
  const tableY = px(306);
  const tableW = width - tableX * 2;
  const tableH = px(244);

  // Raised oval felt table with a distinct gold rail and soft inner highlight.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2, tableW * .49, tableH * .50, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(10,0,4,.35)";
  ctx.fill();
  ctx.lineWidth = px(5);
  ctx.strokeStyle = "rgba(235,190,93,.78)";
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2, tableW * .47, tableH * .465, 0, 0, Math.PI * 2);
  ctx.lineWidth = px(1.5);
  ctx.strokeStyle = "rgba(255,231,164,.35)";
  ctx.stroke();
  ctx.restore();

  drawText(ctx, "BÀI TRÊN BÀN", width / 2, tableY + px(43), scale, {
    size: 14, weight: 900, color: "#ffe19b", align: "center"
  });

  const lastPlay = room.lastPlay;
  if (lastPlay && Array.isArray(lastPlay.cards) && lastPlay.cards.length) {
    drawText(ctx, (lastPlay.name || "Người chơi") + " VỪA ĐÁNH",
      width / 2, tableY + px(72), scale, {
        size: 12, weight: 900, color: "#f8ead0", align: "center"
      });
    const cards = lastPlay.cards.slice(0, 13);
    const cardGap = px(5);
    const available = tableW - px(54);
    const cardW = Math.min(px(60), Math.floor((available - cardGap * (cards.length - 1)) / cards.length));
    const cardH = px(100);
    const total = cards.length * cardW + (cards.length - 1) * cardGap;
    const startX = (width - total) / 2;
    cards.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + cardGap), tableY + px(88),
      cardW, cardH, scale, { small: true }));
    const combo = room.currentCombo;
    if (combo) {
      const label = String(combo.type || "BÀI").toUpperCase().replace("PAIRRUN", "ĐÔI THÔNG")
        .replace("FOURKIND", "TỨ QUÝ").replace("STRAIGHT", "SẢNH")
        .replace("SINGLE", "LẺ").replace("PAIR", "ĐÔI").replace("TRIPLE", "SÁM CÔ");
      drawText(ctx, label + (combo.type === "pairRun" ? " " + combo.length + " ĐÔI" : ""),
        width / 2, tableY + tableH - px(17), scale, {
          size: 10, weight: 900, color: "#ffda7e", align: "center"
        });
    }
  } else {
    const title = room.status === "waiting"
      ? "MỜI NGƯỜI CHƠI THAM GIA"
      : room.playedCount === 0 ? (room.previousWinnerUid ? "NGƯỜI THẮNG VÁN TRƯỚC ĐI ĐẦU" : "NGƯỜI MỞ ĐẦU NGẪU NHIÊN") : "CHƯA CÓ BÀI TRÊN BÀN";
    drawText(ctx, title, width / 2, tableY + px(133), scale, {
      size: 17, weight: 900, color: "#f4dfb0", align: "center"
    });
    drawText(ctx, room.status === "waiting"
      ? "GỬI: join " + String(room.id || "-----")
      : "ĐÁNH BỘ ĐẦU TIÊN ĐỂ MỞ VÒNG",
      width / 2, tableY + px(164), scale, {
        size: 11, weight: 800, color: "#a8d2bc", align: "center"
      });
  }

  if (room.status === "waiting") {
    roundPanel(ctx, width - px(170), px(28), px(112), px(42), px(12), "#087a3d", "#e7d77a");
    drawText(ctx, "◷ 60s", width - px(114), px(56), scale, {
      size: 15, weight: 900, color: "#fff6d4", align: "center"
    });
  } else if (room.turnUid) {
    const current = players.find(item => item.uid === room.turnUid);
    drawText(ctx, "⏳ LƯỢT CỦA " + String(current?.name || "NGƯỜI CHƠI").toUpperCase() + "  •  60 GIÂY",
      width / 2, px(700), scale, {
        size: 13, weight: 900, color: "#fff0bc", align: "center"
      });
  }

  const footer = room.practice
    ? "LUYỆN TẬP VS 3 AI  •  KHÔNG CƯỢC XU  •  BÀI RIÊNG KHÔNG LỘ TRONG NHÓM"
    : room.status === "waiting"
      ? "CHỦ PHÒNG BẤM START KHI CÓ TỪ 2 ĐẾN 4 NGƯỜI"
      : "BÀI RIÊNG QUA INBOX  •  NHÓM CHỈ HIỆN LÁ BÀI ĐƯỢC ĐÁNH";
  drawText(ctx, footer, width / 2, px(744), scale, {
    size: 10, weight: 900, color: "#e5c780", align: "center"
  });
}

function renderHand(ctx, width, height, scale, data) {
  const room = data.room || {};
  const player = data.player || {};
  const hand = Array.isArray(data.hand) ? data.hand : [];
  const px = value => Math.round(value * scale);
  const premium = Boolean(data.isAdmin);
  drawText(ctx, premium ? "JOHNTRAN  /  ADMIN ROYAL HAND" : "JOHNTRAN  /  PRIVATE HAND", px(58), px(52), scale, {
    size: 12, weight: 900, color: premium ? "#ffe08a" : "#ffd34f"
  });
  drawText(ctx, premium ? "👑 BÀI HOÀNG GIA CỦA ADMIN" : "BÀI RIÊNG CỦA BẠN", width / 2, px(112), scale, {
    size: premium ? 31 : 34, weight: 900, color: premium ? "#ffe08a" : "#fff1ce", align: "center"
  });
  drawText(ctx, (player.name || "Người chơi") + "   •   BÀN #" + String(room.id || "-----") +
    "   •   CÒN " + hand.length + " LÁ",
    width / 2, px(151), scale, {
      size: 14, weight: 800, color: "#a9d5c1", align: "center"
    });
  roundPanel(ctx, px(48), px(190), width - px(96), px(270), px(20),
    premium ? "rgba(83,43,4,.92)" : "rgba(62,2,12,.88)",
    premium ? "rgba(255,220,126,.98)" : "rgba(255,203,54,.72)");
  if (!hand.length) {
    drawText(ctx, "BẠN ĐÃ HẾT BÀI!", width / 2, px(337), scale, {
      size: 30, weight: 900, color: "#2ce8ae", align: "center"
    });
  } else {
    // Larger hand cards use a slight overlap for 11–13 cards so rank,
    // suit and the numbered selection badge remain easy to read on mobile.
    const cardW = px(hand.length > 10 ? 72 : 82);
    const cardH = px(148);
    const gap = px(hand.length > 10 ? -8 : 8);
    const total = hand.length * cardW + Math.max(0, hand.length - 1) * gap;
    const startX = Math.max(px(58), (width - total) / 2);
    const y = hand.length > 10 ? px(242) : px(250);
    hand.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + gap), y, cardW, cardH, scale, {
        small: true, premium, index: index + 1
      }));
  }

  const commandY = px(514);
  roundPanel(ctx, px(48), px(492), width - px(96), px(170), px(16),
    "rgba(27,0,7,.58)", "rgba(205,175,110,.30)");
  drawText(ctx, data.isTurn ? "🎯 ĐẾN LƯỢT BẠN" : "🔒 BÀI CỦA RIÊNG BẠN",
    px(78), commandY + px(18), scale, {
      size: 16, weight: 900, color: data.isTurn ? "#ffd34f" : "#e7d4a9"
    });
  drawText(ctx, "Lẻ: 4r  •  Đôi: doi 4  •  Sám: sam 7  •  Sảnh: sanh 345",
    px(78), commandY + px(55), scale, {
      size: 12, weight: 900, color: "#fff0cf"
    });
  drawText(ctx, "Chọn số: chon 1,2  •  Gợi ý: goiy  •  Tự đánh: auto",
    px(78), commandY + px(88), scale, {
      size: 12, weight: 900, color: "#76f0cd"
    });
  drawText(ctx, "Tứ quý: tuquy 4  •  Đôi thông: 3dt / 4dt  •  Bỏ: bo",
    px(78), commandY + px(120), scale, {
      size: 11, weight: 800, color: "#c0d9ca"
    });
  drawText(ctx, "Thứ tự từ trái sang phải  •  b Bích  •  ch Chuồn  •  r Rô  •  c Cơ",
    px(78), commandY + px(145), scale, {
      size: 10, weight: 900, color: "#ffd34f"
    });
  drawText(ctx, room.practice
    ? "LUYỆN TẬP VS AI  •  KHÔNG TRỪ XU"
    : "CƯỢC " + String(room.bet || 5000) + "$  •  NHẤT NHÌ BA BÉT",
    width / 2, px(710), scale, {
      size: 10, weight: 900, color: premium ? "#ffe08a" : "#8ba79a", align: "center"
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

module.exports = { renderTlmn, _test: { suitInfo, rankText, seatLayout } };
