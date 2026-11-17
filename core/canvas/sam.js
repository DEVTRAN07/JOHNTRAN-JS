"use strict";

const theme = require("./theme");
const { drawPlayingCard } = require("./playingCards");

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

function seatLayout(count) {
  if (Number(count) >= 4) {
    return [
      { x: 370, y: 174, w: 340, h: 92 },
      { x: 22, y: 380, w: 230, h: 96 },
      { x: 370, y: 568, w: 340, h: 92 },
      { x: 828, y: 380, w: 230, h: 96 }
    ];
  }
  if (Number(count) === 3) {
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

function drawSeat(ctx, player, x, y, w, h, scale, index, isTurn, room) {
  const px = value => Math.round(value * scale);
  const active = Boolean(player && isTurn);
  panel(ctx, x, y, w, h, px(16),
    active ? "rgba(12,91,65,.97)" : "rgba(7,29,22,.94)",
    active ? "#68e9b5" : "rgba(212,181,111,.48)");

  const avatarX = x + px(40);
  const avatarY = y + h / 2;
  const radius = px(25);
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, radius, 0, Math.PI * 2);
  ctx.fillStyle = active ? "#147755" : "#153d30";
  ctx.fill();
  ctx.lineWidth = px(active ? 3.5 : 2);
  ctx.strokeStyle = active ? "#74f0bd" : "#b99a5a";
  ctx.stroke();
  ctx.restore();

  if (!player) {
    text(ctx, "+", avatarX, avatarY + px(8), scale, {
      size: 24, color: "#fff9e9", align: "center"
    });
    text(ctx, "GHẾ TRỐNG", x + px(80), y + h / 2 + px(5), scale, {
      size: 13, color: "#a6b9ad"
    });
    return;
  }

  text(ctx, player.ai ? "AI" :
    String(player.name || "P").trim().slice(0, 1).toUpperCase(),
    avatarX, avatarY + px(8), scale, {
      size: 21, color: "#fff9e9", align: "center"
    });
  const name = String(player.name || "Người chơi").replace(/[\r\n\t]+/g, " ");
  text(ctx, name.length > 22 ? name.slice(0, 20) + "…" : name,
    x + px(80), y + px(36), scale, {
      size: 16, color: "#fff9e9",
      maxWidth: w - px(w < px(260) ? 112 : 152)
    });
  const count = player.handCount == null ? "ĐANG CHỜ" : player.handCount + " LÁ";
  text(ctx, count, x + px(80), y + px(68), scale, {
    size: 12, color: active ? "#ffe09a" : "#b9d1c5"
  });

  if (active) {
    panel(ctx, x + w - px(94), y + px(22), px(76), px(34),
      px(10), "#0e7655", "#71e9b8");
    text(ctx, "LƯỢT", x + w - px(56), y + px(45), scale, {
      size: 11, color: "#fffdf3", align: "center"
    });
  } else if (player.place > 0) {
    text(ctx, "HẠNG " + player.place, x + w - px(15), y + px(48), scale, {
      size: 10, color: "#e1c486", align: "right"
    });
  } else {
    text(ctx, "NGƯỜI CHƠI " + (index + 1), x + w - px(15), y + px(48), scale, {
      size: 9, color: "#9eb7aa", align: "right"
    });
  }
}

function comboLabel(combo) {
  if (!combo) return "";
  const labels = {
    single: "LẺ",
    pair: "ĐÔI",
    triple: "SÁM",
    straight: "SẢNH",
    fourKind: "TỨ QUÝ",
    bomb: "TỨ QUÝ"
  };
  const name = labels[combo.type] || String(combo.type || "BỘ BÀI").toUpperCase();
  return name + (combo.type === "straight" && combo.length ? "  •  " + combo.length + " LÁ" : "");
}

function renderTable(ctx, width, height, scale, data) {
  const room = data.room || {};
  const players = Array.isArray(room.players) ? room.players : [];
  const px = value => Math.round(value * scale);

  text(ctx, "JOHNTRAN  /  GAME TABLE", px(58), px(52), scale, {
    size: 12, color: "#edc979"
  });
  text(ctx, "SÂM LỐC", width / 2, px(107), scale, {
    size: 39, color: "#fff9e9", align: "center"
  });
  text(ctx, "BÀN #" + String(room.id || "-----") + "   •   CƯỢC " +
    Number(room.bet || 300).toLocaleString("vi-VN") + " XU   •   " +
    players.length + "/4 NGƯỜI",
    width / 2, px(145), scale, {
      size: 13, color: "#c6ded1", align: "center"
    });

  seatLayout(players.length).forEach((position, index) => {
    drawSeat(ctx, players[index] || null,
      px(position.x), px(position.y), px(position.w), px(position.h),
      scale, index, Boolean(players[index] && players[index].uid === room.turnUid), room);
  });

  const tableX = players.length >= 4 ? px(254) : px(174);
  const tableY = px(304);
  const tableW = width - tableX * 2;
  const tableH = px(246);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2 + px(5),
    tableW * .49, tableH * .50, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.fill();
  ctx.strokeStyle = "#a9803b";
  ctx.lineWidth = px(7);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(width / 2, tableY + tableH / 2 + px(5),
    tableW * .47, tableH * .465, 0, 0, Math.PI * 2);
  const felt = ctx.createRadialGradient(width / 2, tableY + px(42), px(20),
    width / 2, tableY + tableH / 2, tableW * .60);
  felt.addColorStop(0, "#176d4d");
  felt.addColorStop(.58, "#0d5139");
  felt.addColorStop(1, "#073321");
  ctx.fillStyle = felt;
  ctx.fill();
  ctx.strokeStyle = "rgba(232,199,126,.58)";
  ctx.lineWidth = px(1.6);
  ctx.stroke();
  ctx.restore();

  panel(ctx, width / 2 - px(75), tableY + px(13),
    px(150), px(28), px(10), "rgba(2,28,19,.54)", "rgba(228,197,130,.25)");
  text(ctx, "BÀI TRÊN BÀN", width / 2, tableY + px(33), scale, {
    size: 12, color: "#f7dfaa", align: "center"
  });

  if (room.lastPlay?.cards?.length) {
    text(ctx, (room.lastPlay.name || "Người chơi") + " VỪA ĐÁNH",
      width / 2, tableY + px(65), scale, {
        size: 12, color: "#f7f7e9", align: "center"
      });
    const cards = room.lastPlay.cards.slice(0, 10);
    const twoRows = cards.length > 8;
    const columns = twoRows ? Math.ceil(cards.length / 2) : cards.length;
    const gap = px(5);
    const available = tableW - px(62);
    const cardW = Math.min(px(twoRows ? 58 : 66),
      Math.floor((available - gap * Math.max(0, columns - 1)) / Math.max(1, columns)));
    const cardH = px(twoRows ? 68 : 105);
    cards.forEach((card, index) => {
      const row = twoRows && index >= columns ? 1 : 0;
      const column = twoRows ? index % columns : index;
      const count = twoRows && row === 1 ? cards.length - columns : columns;
      const rowWidth = count * cardW + Math.max(0, count - 1) * gap;
      drawPlayingCard(ctx, card,
        (width - rowWidth) / 2 + column * (cardW + gap),
        tableY + px(twoRows ? 77 + row * 74 : 80),
        cardW, cardH, scale, { small: true });
    });
    const label = comboLabel(room.currentCombo);
    if (label) text(ctx, label, width / 2, tableY + tableH - px(10), scale, {
      size: 11, color: "#ffe09a", align: "center"
    });
  } else {
    const message = room.status === "waiting"
      ? "MỜI NGƯỜI CHƠI THAM GIA"
      : room.playedCount === 0
        ? (room.previousWinnerUid ? "NGƯỜI THẮNG VÁN TRƯỚC ĐI ĐẦU" : "CHỜ NƯỚC ĐÁNH ĐẦU TIÊN")
        : "VÒNG MỚI ĐANG CHỜ";
    text(ctx, message, width / 2, tableY + px(122), scale, {
      size: 16, color: "#fff3d1", align: "center"
    });
    text(ctx, room.status === "waiting"
      ? "NHẬP JOIN " + String(room.id || "-----") + " ĐỂ VÀO BÀN"
      : "NGƯỜI ĐẾN LƯỢT SẼ MỞ VÒNG MỚI",
      width / 2, tableY + px(155), scale, {
      size: 11, color: "#bce5d1", align: "center"
    });
  }

  if (room.samStatus) {
    const statusText = room.samStatus === "called" ? "🔥 ĐANG BÁO SÂM" :
      room.samStatus === "success" ? "✓ BÁO SÂM THÀNH CÔNG" : "✕ LỦNG SÂM";
    const statusColor = room.samStatus === "failed" ? "#7e2430" : "#0e7655";
    panel(ctx, width - px(286), px(82), px(236), px(38),
      px(12), statusColor, "#e4c783");
    text(ctx, statusText, width - px(168), px(107), scale, {
      size: 12, color: "#fff9e9", align: "center"
    });
  }

  if (room.status === "waiting") {
    panel(ctx, width - px(172), px(28), px(112), px(40),
      px(12), "#0c6847", "#d7bc78");
    text(ctx, "● PHÒNG CHỜ", width - px(116), px(54), scale, {
      size: 10, color: "#fff8e5", align: "center"
    });
  } else if (room.turnUid) {
    const current = players.find(item => item.uid === room.turnUid);
    panel(ctx, width / 2 - px(235), px(684), px(470), px(38),
      px(12), "rgba(6,49,35,.92)", "rgba(103,223,174,.42)");
    text(ctx, "ĐẾN LƯỢT: " + String(current?.name || "NGƯỜI CHƠI").toUpperCase(),
      width / 2, px(709), scale, {
        size: 13, color: "#e7f8ec", align: "center"
      });
  }

  if (data.notice) {
    text(ctx, String(data.notice).replace(/[\r\n\t]+/g, " ").slice(0, 90),
      width / 2, px(744), scale, {
        size: 10, color: "#ffe09a", align: "center", maxWidth: width - px(100)
      });
  } else {
    text(ctx, "LẺ  •  ĐÔI  •  SÁM  •  SẢNH  •  TỨ QUÝ  •  BÁO SÂM",
      width / 2, px(752), scale, {
        size: 10, color: "#c5aa72", align: "center"
      });
  }
}

function renderHand(data = {}) {
  theme.initFonts();
  theme.ensureTheme();
  const width = theme.WIDTH;
  const scale = width / 1080;
  const px = value => Math.round(value * scale);
  const height = px(780);
  const { canvas, ctx } = theme.newCanvas(width, height);
  theme.paintBackground(ctx, width, height);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#061b14");
  background.addColorStop(.48, "#0a3828");
  background.addColorStop(1, "#03120d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, px(365), px(30),
    width / 2, px(390), px(640));
  glow.addColorStop(0, "rgba(50,160,105,.18)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  theme.roundRect(ctx, px(20), px(20), width - px(40), height - px(40), px(24));
  ctx.strokeStyle = "rgba(211,177,108,.46)";
  ctx.lineWidth = px(2);
  ctx.stroke();
  const room = data.room || {};
  const player = data.player || {};
  const hand = Array.isArray(data.hand) ? data.hand : [];
  const admin = Boolean(data.isAdmin);

  text(ctx, admin ? "JOHNTRAN  /  ADMIN ROYAL HAND" : "JOHNTRAN  /  PRIVATE HAND",
    px(58), px(52), scale, {
      size: 12, color: admin ? "#f5d58b" : "#edc979"
    });
  text(ctx, admin ? "BÀI HOÀNG GIA" : "BÀI CỦA BẠN",
    width / 2, px(108), scale, {
      size: 36, color: admin ? "#ffe4a0" : "#fff9e9", align: "center"
    });
  text(ctx, (player.name || "Người chơi") + "   •   BÀN #" +
    String(room.id || "-----") + "   •   CÒN " + hand.length + " LÁ",
    width / 2, px(146), scale, {
      size: 14, color: "#c6ded1", align: "center"
    });

  panel(ctx, px(36), px(177), width - px(72), px(309),
    px(21), "rgba(5,30,22,.94)",
    admin ? "rgba(238,195,103,.95)" : "rgba(122,205,164,.56)");

  if (!hand.length) {
    text(ctx, "BẠN ĐÃ HẾT BÀI!", width / 2, px(337), scale, {
      size: 30, color: "#70efb8", align: "center"
    });
  } else {
    const cardW = px(86);
    const cardH = px(176);
    const gap = hand.length > 8 ? px(-8) : px(3);
    const total = hand.length * cardW + Math.max(0, hand.length - 1) * gap;
    const startX = Math.max(px(49), (width - total) / 2);
    const y = px(229);
    hand.forEach((card, index) => drawPlayingCard(ctx, card,
      startX + index * (cardW + gap), y, cardW, cardH, scale, {
        small: false, premium: admin, index: index + 1
      }));
  }

  panel(ctx, px(42), px(511), width - px(84), px(178),
    px(18), "rgba(5,25,19,.94)", "rgba(213,184,121,.36)");
  text(ctx, data.isTurn ? "●  ĐẾN LƯỢT BẠN" : "🔒  BÀI RIÊNG CỦA BẠN",
    px(70), px(548), scale, {
      size: 17, color: data.isTurn ? "#7df0bd" : "#edcf8a"
    });
  text(ctx, "ĐÁNH  •  Lẻ: 3b   |   Đôi: doi 7   |   Sám: sam 9   |   Tứ quý: tuquy 5",
    px(70), px(582), scale, {
      size: 13, color: "#fff8e8"
    });
  text(ctx, "SẢNH  •  sanh 345   |   Chọn lá: chon 1,2   |   Bỏ lượt: pass",
    px(70), px(616), scale, {
      size: 13, color: "#8ee5c0"
    });
  text(ctx, "BÁO SÂM  •  baosam   |   Sâm so số, không so chất",
    px(70), px(649), scale, {
      size: 12, color: "#d7e7dc"
    });
  text(ctx, "SỐ TRÊN LÁ = THỨ TỰ CHỌN  •  BÍCH (b)  CHUỒN (ch)  RÔ (r)  CƠ (c)",
    width / 2, px(676), scale, {
      size: 10, color: "#e3c783", align: "center"
    });
  text(ctx, "CƯỢC " + Number(room.bet || 300).toLocaleString("vi-VN") + " XU  •  SÂM LỐC",
    width / 2, px(744), scale, {
      size: 10, color: admin ? "#ffe2a0" : "#9db9aa", align: "center"
    });

  return theme.save(canvas, "sam");
}

function renderSam(data = {}) {
  theme.initFonts();
  theme.ensureTheme();
  if (data.view !== "table") return renderHand(data);

  const width = theme.WIDTH;
  const scale = width / 1080;
  const px = value => Math.round(value * scale);
  const { canvas, ctx } = theme.newCanvas(width, px(780));
  theme.paintBackground(ctx, width, px(780));

  const background = ctx.createLinearGradient(0, 0, width, px(780));
  background.addColorStop(0, "#061b14");
  background.addColorStop(.48, "#0a3828");
  background.addColorStop(1, "#03120d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, px(780));
  const glow = ctx.createRadialGradient(width / 2, px(365), px(30),
    width / 2, px(390), px(640));
  glow.addColorStop(0, "rgba(50,160,105,.18)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, px(780));
  theme.roundRect(ctx, px(20), px(20), width - px(40), px(740), px(24));
  ctx.strokeStyle = "rgba(211,177,108,.46)";
  ctx.lineWidth = px(2);
  ctx.stroke();

  renderTable(ctx, width, px(780), scale, data);
  return theme.save(canvas, "sam");
}

module.exports = {
  renderSam,
  _test: { drawSeat, seatLayout, comboLabel }
};
