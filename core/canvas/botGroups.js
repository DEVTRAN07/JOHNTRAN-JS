"use strict";

const avatarCache = require("./avatarCache");
const theme = require("./theme");

function drawAvatar(ctx, group, x, y, size) {
  const S = theme.S;
  const image = avatarCache.getAvatar(group.avatar);
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
    ctx.font = theme.font(18, "JT-Bold");
    ctx.fillStyle = theme.PALETTE.accent;
    ctx.textAlign = "center";
    const initial = Array.from(String(group.name || "N"))[0] || "N";
    ctx.fillText(theme.sanitizeGlyphs(initial.toUpperCase()), x + size / 2, y + size / 2 + S(6));
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + S(1), 0, Math.PI * 2);
  ctx.strokeStyle = theme.PALETTE.accent;
  ctx.lineWidth = S(1.3);
  ctx.stroke();
}

function drawGroupTile(ctx, group, index, x, y, width, height) {
  const S = theme.S;
  const palette = theme.PALETTE;
  theme.panel(ctx, x, y, width, height, S(11), "rgba(212,175,55,.36)");

  const avatarSize = S(35);
  drawAvatar(ctx, group, x + S(11), y + (height - avatarSize) / 2, avatarSize);

  const textX = x + S(58);
  const textWidth = width - S(104);
  theme.text(ctx, group.name || "Nhóm Zalo", textX, y + S(25), {
    size: 13,
    family: "JT-Bold",
    color: palette.ink,
    maxWidth: textWidth
  });
  const memberCount = Number(group.totalMember) || 0;
  const meta = memberCount > 0
    ? memberCount.toLocaleString("vi-VN") + " thành viên"
    : "ID " + String(group.gid || "");
  theme.text(ctx, meta, textX, y + S(43), {
    size: 9,
    family: "JT-Mono",
    color: palette.mute,
    maxWidth: textWidth
  });

  theme.label(ctx, "ON", x + width - S(12), y + S(24), {
    size: 9,
    color: palette.green,
    align: "right"
  });
}

async function renderBotGroups(options = {}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const pad = S(25);
  const gap = S(9);
  const columns = 2;
  const groups = Array.isArray(options.groups) ? options.groups : [];
  const rows = Math.ceil(groups.length / columns);
  const tileHeight = S(57);
  const headerHeight = S(175);
  const rowGap = S(8);
  const listHeight = groups.length ? rows * tileHeight + Math.max(0, rows - 1) * rowGap : S(105);
  const height = Math.max(S(360), headerHeight + listHeight + S(66));
  const tileWidth = (W - pad * 2 - gap) / columns;
  const { ctx, canvas } = theme.newCanvas(W, height);

  await theme.paintBackground(ctx, W, height);
  const palette = theme.PALETTE;

  theme.label(ctx, "JOHNTRAN  /  GROUP CONTROL", pad, S(38), { size: 11 });
  theme.text(ctx, "CÁC NHÓM ĐANG BẬT", pad, S(82), {
    size: 29,
    family: "JT-Display-Bold",
    color: palette.ink,
    maxWidth: W - pad * 2
  });
  theme.foil(ctx, pad, S(96), S(128));
  theme.text(ctx, options.botName || "JOHNTRAN", pad, S(121), {
    size: 13,
    family: "JT-Bold",
    color: palette.ink2,
    maxWidth: W - pad * 2
  });

  theme.panel(ctx, pad, S(137), W - pad * 2, S(31), S(8), palette.green);
  theme.label(ctx, String(groups.length) + " NHÓM ĐANG CHO PHÉP BOT HOẠT ĐỘNG", pad + S(13), S(157), {
    size: 10,
    color: palette.green
  });

  const startY = headerHeight;
  if (groups.length) {
    groups.forEach((group, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = pad + column * (tileWidth + gap);
      const y = startY + row * (tileHeight + rowGap);
      drawGroupTile(ctx, group, index, x, y, tileWidth, tileHeight);
    });
  } else {
    theme.panel(ctx, pad, startY, W - pad * 2, S(92), S(12), palette.mute);
    theme.text(ctx, "Chưa có nhóm nào đang bật", W / 2, startY + S(42), {
      size: 17, family: "JT-Bold", color: palette.ink2, align: "center"
    });
    theme.text(ctx, "Các nhóm đang OFF sẽ không xuất hiện trong danh sách.", W / 2, startY + S(64), {
      size: 10, color: palette.mute, align: "center"
    });
  }

  const footerY = height - S(31);
  theme.label(ctx, "JOHNTRAN  •  BOT GROUP STATUS", W - pad, footerY, {
    size: 9, color: palette.mute, align: "right"
  });
  return theme.save(canvas, "bot_groups");
}

module.exports = { renderBotGroups, _test: { drawAvatar, drawGroupTile } };
