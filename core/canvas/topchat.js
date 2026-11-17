"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");

function drawAvatar(ctx, item, x, y, size) {
  const S = theme.S;
  const palette = theme.PALETTE;
  const image = avatarCache.getAvatar(item?.avatar);
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
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, "#123d55");
    gradient.addColorStop(1, "#0b2638");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.font = theme.font(Math.max(14, size / S(2.7)), "JT-Bold");
    ctx.fillStyle = palette.accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = Array.from(String(item?.name || "?").trim())[0] || "?";
    ctx.fillText(theme.sanitizeGlyphs(initial.toUpperCase()), x + size / 2, y + size / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + S(1), 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = S(1.2);
  ctx.stroke();
}

function drawRankCard(ctx, item, rank, x, y, width, height, featured = false) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, height, S(featured ? 13 : 10),
    rank === 0 ? palette.accent : "rgba(85,214,232,.34));

  if (featured) {
    theme.label(ctx, "TOP " + String(rank + 1).padStart(2, "0"), x + S(13), y + S(19), {
      size: 9, color: rank === 0 ? palette.accent : palette.mute
    });
    const avatarSize = S(43);
    drawAvatar(ctx, item, x + S(12), y + S(29), avatarSize);
    const textX = x + S(64);
    const textWidth = width - S(77);
    theme.text(ctx, item.name || "Thành viên", textX, y + S(49), {
      size: 13, family: "JT-Bold", color: palette.ink, maxWidth: textWidth
    });
    theme.text(ctx, Number(item.count || 0).toLocaleString("vi-VN") + " tin nhắn", textX, y + S(70), {
      size: 10, family: "JT-Mono", color: palette.accent, maxWidth: textWidth
    });
    return;
  }

  theme.text(ctx, String(rank + 1).padStart(2, "0"), x + S(11), y + S(36), {
    size: 14, family: "JT-Mono-Bold", color: palette.accent
  });
  const avatarSize = S(34);
  drawAvatar(ctx, item, x + S(42), y + (height - avatarSize) / 2, avatarSize);
  const textX = x + S(86);
  const rightWidth = S(54);
  theme.text(ctx, item.name || "Thành viên", textX, y + S(27), {
    size: 12, family: "JT-Bold", color: palette.ink,
    maxWidth: width - (textX - x) - rightWidth - S(8)
  });
  theme.text(ctx, Number(item.count || 0).toLocaleString("vi-VN") + " tin", textX, y + S(45), {
    size: 9, family: "JT-Mono", color: palette.mute
  });
}

function wrapText(ctx, value, maxWidth) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
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
  return lines;
}

async function renderTopChat(options = {}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const rows = Array.isArray(options.ranking) ? options.ranking.slice(0, 10) : [];
  const featured = rows.slice(0, 3);
  const remaining = rows.slice(3);
  const pad = S(25);
  const gap = S(9);
  const headerHeight = S(145);
  const featuredHeight = S(91);
  const compactHeight = S(56);
  const compactGap = S(8);
  const columns = 2;
  const cardWidth = (W - pad * 2 - gap * (columns - 1)) / columns;
  const compactRows = Math.ceil(remaining.length / columns);
  const listHeight = rows.length
    ? featuredHeight + (remaining.length ? S(34) + compactRows * (compactHeight + compactGap) : 0)
    : S(152);
  const height = Math.max(S(355), headerHeight + listHeight + S(57));
  const { ctx, canvas } = theme.newCanvas(W, height);
  await theme.paintBackground(ctx, W, height);
  const palette = theme.PALETTE;

  theme.label(ctx, "JOHN TRAN  /  GROUP INSIGHTS", pad, S(34), { size: 11 });
  theme.text(ctx, "TOP CHAT HÔM NAY", pad, S(76), {
    size: 29, family: "JT-Display-Bold", color: palette.ink,
    maxWidth: W - pad * 2
  });
  theme.foil(ctx, pad, S(88), S(126));
  theme.text(ctx, options.subtitle || "BẢNG XẾP HẠNG TIN NHẮN TRONG NGÀY", pad, S(111), {
    size: 11, family: "JT-Mono", color: palette.ink2,
    maxWidth: W - pad * 2
  });

  theme.panel(ctx, pad, S(123), W - pad * 2, S(28), S(8), palette.accent);
  const total = Number(options.totalMessages) || rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  theme.label(ctx,
    rows.length
      ? rows.length + " THÀNH VIÊN ĐƯỢC XẾP HẠNG  ·  " + total.toLocaleString("vi-VN") + " TIN"
      : "CHƯA CÓ DỮ LIỆU XẾP HẠNG",
    pad + S(12), S(141), { size: 9, color: palette.accent });

  if (rows.length) {
    const startY = headerHeight;
    if (featured.length) {
      const featuredWidth = (W - pad * 2 - gap * (featured.length - 1)) / featured.length;
      featured.forEach((item, index) => {
        drawRankCard(ctx, item, index, pad + index * (featuredWidth + gap), startY, featuredWidth, featuredHeight, true);
      });
    }

    if (remaining.length) {
      const labelY = startY + featuredHeight + S(25);
      theme.label(ctx, "BẢNG XẾP HẠNG TIẾP THEO", pad, labelY, { size: 10, color: palette.mute });
      const listY = labelY + S(13);
      remaining.forEach((item, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        drawRankCard(ctx, item, index + 3,
          pad + column * (cardWidth + gap),
          listY + row * (compactHeight + compactGap),
          cardWidth, compactHeight, false);
      });
    }
  } else {
    const emptyY = headerHeight;
    theme.panel(ctx, pad, emptyY, W - pad * 2, S(132), S(12), palette.mute);
    theme.label(ctx, "TRẠNG THÁI THỐNG KÊ", pad + S(15), emptyY + S(25), { size: 9, color: palette.mute });
    ctx.save();
    ctx.font = theme.font(10, "JT");
    const lines = wrapText(ctx,
      options.emptyMessage || "Chưa có tin nhắn đủ điều kiện để xếp hạng.",
      W - pad * 2 - S(36)
    );
    ctx.restore();
    lines.slice(0, 5).forEach((line, index) => {
      theme.text(ctx, line, pad + S(15), emptyY + S(52) + index * S(15), {
        size: 10, color: palette.ink2,
        maxWidth: W - pad * 2 - S(30)
      });
    });
  }

  const footerY = height - S(24);
  theme.label(ctx, "JOHNTRAN  •  TOP CHAT DAILY", W - pad, footerY, {
    size: 9, color: palette.mute, align: "right"
  });
  return theme.save(canvas, "topchat");
}

module.exports = {
  renderTopChat,
  _test: { drawAvatar, drawRankCard, wrapText }
};
