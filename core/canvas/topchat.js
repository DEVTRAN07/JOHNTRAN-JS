"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");

function drawAvatar(ctx, item, x, y, size) {
  const S = theme.S;
  const image = avatarCache.getAvatar(item.avatar);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  } else {
    ctx.fillStyle = "rgba(212,175,55,.16)";
    ctx.fillRect(x, y, size, size);
    ctx.font = theme.font(20, "JT-Bold");
    ctx.fillStyle = theme.PALETTE.accent;
    ctx.textAlign = "center";
    const initial = String(item.name || "?").trim().charAt(0).toUpperCase();
    ctx.fillText(theme.sanitizeGlyphs(initial), x + size / 2, y + size / 2 + S(7));
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + S(1), 0, Math.PI * 2);
  ctx.strokeStyle = theme.PALETTE.accent;
  ctx.lineWidth = S(1.5);
  ctx.stroke();
}

function drawPodiumCard(ctx, item, index, x, y, width, height) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, height, S(13), palette.accent);
  theme.label(ctx, "TOP " + String(index + 1).padStart(2, "0"), x + S(14), y + S(22), {
    size: 10,
    color: palette.accent
  });

  const avatarSize = S(48);
  drawAvatar(ctx, item, x + S(14), y + S(34), avatarSize);
  theme.text(ctx, item.name || "Thành viên", x + S(72), y + S(55), {
    size: 15,
    family: "JT-Bold",
    color: palette.ink,
    maxWidth: width - S(84)
  });
  theme.text(ctx, (Number(item.count) || 0).toLocaleString("vi-VN") + " tin nhắn", x + S(72), y + S(79), {
    size: 12,
    family: "JT-Mono",
    color: palette.ink2,
    maxWidth: width - S(84)
  });
}

function drawRankRow(ctx, item, rank, x, y, width, height) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, height, S(10), "rgba(212,175,55,.38)");

  theme.text(ctx, String(rank + 1).padStart(2, "0"), x + S(15), y + S(37), {
    size: 16,
    family: "JT-Mono-Bold",
    color: palette.accent
  });
  const avatarSize = S(34);
  drawAvatar(ctx, item, x + S(58), y + S(9), avatarSize);
  theme.text(ctx, item.name || "Thành viên", x + S(106), y + S(31), {
    size: 14,
    family: "JT-Bold",
    color: palette.ink,
    maxWidth: width - S(220)
  });
  theme.text(ctx, (Number(item.count) || 0).toLocaleString("vi-VN") + " tin", x + width - S(18), y + S(32), {
    size: 13,
    family: "JT-Mono-Bold",
    color: palette.accent,
    align: "right"
  });
}

async function renderTopChat(options = {}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const rows = Array.isArray(options.ranking) ? options.ranking.slice(0, 10) : [];
  const podium = rows.slice(0, 3);
  const remaining = rows.slice(3);
  const pad = S(26);
  const gap = S(10);
  const podiumHeight = S(94);
  const rowHeight = S(52);
  const headerBottom = S(112);
  const podiumY = headerBottom + S(18);
  const rankTitleY = podiumY + podiumHeight + S(36);
  const rankStartY = rankTitleY + S(22);
  const footerY = rankStartY + remaining.length * (rowHeight + S(8)) + S(18);
  const height = Math.max(S(330), footerY + S(55));
  const { ctx, canvas } = theme.newCanvas(W, height);

  await theme.paintBackground(ctx, W, height);
  const palette = theme.PALETTE;

  theme.label(ctx, "JOHN TRAN  /  THỐNG KÊ NHÓM", pad, S(34), { size: 12 });
  theme.text(ctx, options.title || "TOP CHAT HÔM NAY", pad, S(72), {
    size: 30,
    family: "JT-Display-Bold",
    color: palette.ink,
    maxWidth: W - pad * 2
  });
  theme.foil(ctx, pad, S(84), S(116));
  theme.text(ctx, options.subtitle || "BẢNG XẾP HẠNG TIN NHẮN TRONG NGÀY", pad, S(105), {
    size: 12,
    family: "JT-Mono",
    color: palette.ink2,
    maxWidth: W - pad * 2
  });

  if (podium.length) {
    const cardWidth = (W - pad * 2 - gap * (podium.length - 1)) / podium.length;
    podium.forEach((item, index) => {
      drawPodiumCard(ctx, item, index, pad + index * (cardWidth + gap), podiumY, cardWidth, podiumHeight);
    });
  } else {
    theme.panel(ctx, pad, podiumY, W - pad * 2, podiumHeight, S(13), palette.accent);
    theme.text(ctx, "Chưa có dữ liệu xếp hạng", W / 2, podiumY + S(52), {
      size: 16, family: "JT-Bold", color: palette.ink2, align: "center"
    });
  }

  if (remaining.length) {
    theme.label(ctx, "THÀNH VIÊN TIẾP THEO", pad, rankTitleY, { size: 11, color: palette.accent });
    remaining.forEach((item, index) => {
      drawRankRow(ctx, item, index + 3, pad, rankStartY + index * (rowHeight + S(8)), W - pad * 2, rowHeight);
    });
  }

  theme.label(ctx, "JOHNTRAN  •  TOP CHAT DAILY", W - pad, footerY + S(24), {
    size: 9,
    color: palette.mute,
    align: "right"
  });
  return theme.save(canvas, "topchat");
}

module.exports = { renderTopChat, _test: { drawAvatar, drawPodiumCard, drawRankRow } };
