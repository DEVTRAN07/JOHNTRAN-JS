"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");
const PODIUM = ["#f0c86d", "#b9c7d8", "#d89a72"];

function drawAvatar(ctx, item, x, y, size, accent) {
  const S = theme.S, p = theme.PALETTE;
  const image = avatarCache.getAvatar(item?.avatar);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale, h = image.height * scale;
    ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x + size, y + size);
    g.addColorStop(0, "#102b4b");
    g.addColorStop(.55, "#123b5b");
    g.addColorStop(1, "#241d50");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, size, size);

    const nameParts = String(item?.name || "?").trim().split(/\\s+/).filter(Boolean);
    const initials = nameParts.length > 1
      ? (Array.from(nameParts[0])[0] + Array.from(nameParts[nameParts.length - 1])[0]).toUpperCase()
      : Array.from(nameParts[0] || "?").slice(0, 2).join("").toUpperCase();
    ctx.font = theme.font(Math.max(14, size / S(2.5)), "JT-Bold");
    ctx.fillStyle = theme.randomTextColor(initials + ":topchat");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(54,222,255,.82)";
    ctx.shadowBlur = S(6);
    ctx.fillText(theme.sanitizeGlyphs(initials), x + size / 2, y + size / 2);
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + S(2), 0, Math.PI * 2);
  ctx.strokeStyle = accent || p.accent;
  ctx.lineWidth = S(2);
  ctx.shadowColor = "rgba(50,220,255,.72)";
  ctx.shadowBlur = S(6);
  ctx.stroke();
  ctx.restore();
}

function drawRankCard(ctx, item, rank, x, y, width, height, featured = false) {
  const S = theme.S, p = theme.PALETTE;
  const accent = featured ? PODIUM[rank] : (rank === 0 ? PODIUM[0] : p.accent);
  theme.panel(ctx, x, y, width, height, S(featured ? 16 : 13), accent);
  if (featured) {
    theme.label(ctx, rank === 0 ? "DẪN ĐẦU" : rank === 1 ? "Á QUÂN" : "TOP 3",
      x + S(16), y + S(23), { size: 9, color: accent });
    theme.text(ctx, String(rank + 1).padStart(2, "0"), x + width - S(14), y + S(35), {
      size: 28, family: "JT-Display-Bold", color: accent, align: "right"
    });
    const avatarSize = S(52);
    drawAvatar(ctx, item, x + S(15), y + S(38), avatarSize, accent);
    theme.text(ctx, item.name || "Thành viên", x + S(79), y + S(61), {
      size: 14, family: "JT-Bold", color: p.ink, maxWidth: width - S(96)
    });
    theme.text(ctx, Number(item.count || 0).toLocaleString("vi-VN") + " tin nhắn",
      x + S(79), y + S(84), {
        size: 11, family: "JT-Mono", color: p.ink2, maxWidth: width - S(96)
      });
    ctx.fillStyle = accent; ctx.globalAlpha = .16;
    theme.roundRect(ctx, x + S(15), y + height - S(18), width - S(30), S(4), S(2));
    ctx.fill(); ctx.globalAlpha = 1;
    return;
  }
  const badge = S(35);
  theme.roundRect(ctx, x + S(12), y + (height - badge) / 2, badge, badge, S(10));
  ctx.fillStyle = "rgba(97,216,242,.13)"; ctx.fill();
  theme.text(ctx, String(rank + 1).padStart(2, "0"), x + S(12) + badge / 2,
    y + height / 2 + S(5), {
      size: 12, family: "JT-Mono-Bold", color: accent, align: "center"
    });
  const avatarSize = S(39);
  drawAvatar(ctx, item, x + S(60), y + (height - avatarSize) / 2, avatarSize, p.accent);
  const textX = x + S(111);
  theme.text(ctx, item.name || "Thành viên", textX, y + S(30), {
    size: 13, family: "JT-Bold", color: p.ink, maxWidth: width - S(195)
  });
  theme.text(ctx, Number(item.count || 0).toLocaleString("vi-VN") + " tin",
    textX, y + S(49), {
      size: 10, family: "JT-Mono", color: p.mute, maxWidth: width - S(195)
    });
  theme.text(ctx, "#" + String(rank + 1), x + width - S(14), y + S(38), {
    size: 10, family: "JT-Mono-Bold", color: accent, align: "right"
  });
}

function wrapText(ctx, value, maxWidth) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? current + " " + word : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current); current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

async function renderTopChat(options = {}) {
  theme.initFonts();
  const S = theme.S, W = theme.WIDTH, p = theme.PALETTE;
  const rows = Array.isArray(options.ranking) ? options.ranking.slice(0, 10) : [];
  const featured = rows.slice(0, 3), remaining = rows.slice(3);
  const pad = S(26), gap = S(10), headH = S(132), podiumH = S(126);
  const itemH = S(67), itemGap = S(9), columns = 2;
  const colW = (W - pad * 2 - gap) / columns;
  const listRows = Math.ceil(remaining.length / columns);
  const emptyH = rows.length ? 0 : S(140);
  const listH = remaining.length ? S(31) + listRows * (itemH + itemGap) : 0;
  const height = headH + (rows.length ? podiumH + S(20) + listH : emptyH) + S(48);
  const { ctx, canvas } = theme.newCanvas(W, height);
  await theme.paintBackground(ctx, W, height);

  theme.label(ctx, "JOHNTRAN  /  GROUP LEADERBOARD", pad, S(30), { size: 10 });
  theme.text(ctx, "TOP CHAT HÔM NAY", pad, S(72), {
    size: 31, family: "JT-Display-Bold", color: p.ink, maxWidth: W - pad * 2
  });
  theme.text(ctx, options.subtitle || "BẢNG XẾP HẠNG HOẠT ĐỘNG TRONG NHÓM",
    pad, S(98), { size: 11, color: p.ink2, maxWidth: W - pad * 2 });
  const total = Number(options.totalMessages) ||
    rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const badgeW = S(145);
  theme.roundRect(ctx, W - pad - badgeW, S(110), badgeW, S(25), S(12));
  ctx.fillStyle = "rgba(97,216,242,.12)"; ctx.fill();
  theme.text(ctx, rows.length + " THÀNH VIÊN  ·  " + total.toLocaleString("vi-VN") + " TIN",
    W - pad - badgeW / 2, S(127), {
      size: 8.5, family: "JT-Bold", color: p.accent, align: "center", maxWidth: badgeW - S(10)
    });

  if (featured.length) {
    const cols = featured.length;
    const cardW = cols === 1 ? Math.min(W - pad * 2, S(390)) :
      (W - pad * 2 - gap * (cols - 1)) / cols;
    const totalW = cols * cardW + (cols - 1) * gap;
    const startX = (W - totalW) / 2;
    featured.forEach((item, i) => {
      drawRankCard(ctx, item, i, startX + i * (cardW + gap), headH, cardW, podiumH, true);
    });
  } else {
    theme.panel(ctx, pad, headH, W - pad * 2, emptyH, S(16), p.muted);
    theme.label(ctx, "CHƯA CÓ DỮ LIỆU", pad + S(18), headH + S(32), { size: 10, color: p.mute });
    theme.text(ctx, options.emptyMessage || "Nhóm chưa có tin nhắn đủ điều kiện để xếp hạng.",
      pad + S(18), headH + S(68), {
        size: 17, family: "JT-Bold", color: p.ink, maxWidth: W - pad * 2 - S(36)
      });
    theme.text(ctx, "Bảng xếp hạng sẽ tự cập nhật khi có hoạt động mới.",
      pad + S(18), headH + S(96), {
        size: 11, color: p.ink2, maxWidth: W - pad * 2 - S(36)
      });
  }

  if (remaining.length) {
    const labelY = headH + podiumH + S(20);
    theme.label(ctx, "CÁC VỊ TRÍ TIẾP THEO", pad, labelY + S(15), { size: 10, color: p.mute });
    remaining.forEach((item, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      drawRankCard(ctx, item, index + 3, pad + col * (colW + gap),
        labelY + S(30) + row * (itemH + itemGap), colW, itemH, false);
    });
  }

  theme.text(ctx, "JOHNTRAN  •  TOP CHAT DAILY", W - pad, height - S(19), {
    size: 9, family: "JT-Mono", color: p.mute, align: "right"
  });
  return theme.save(canvas, "topchat");
}

module.exports = { renderTopChat, _test: { drawAvatar, drawRankCard, wrapText } };
