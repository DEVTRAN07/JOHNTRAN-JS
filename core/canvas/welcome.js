"use strict";

const theme = require("./theme");

function normalizeNames(values) {
  const list = Array.isArray(values) ? values : [];
  const names = list
    .map(value => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
  return names.length ? names : ["Thành viên mới"];
}

function initials(name) {
  const words = String(name || "M").trim().split(/\s+/u).filter(Boolean);
  const first = Array.from(words[0] || "M")[0] || "M";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toLocaleUpperCase("vi-VN");
}

function drawText(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save();
  ctx.shadowColor = "rgba(0,5,16,.78)";
  ctx.shadowBlur = theme.S(bold ? 2.8 : 2);
  ctx.shadowOffsetY = theme.S(0.8);
  ctx.textBaseline = "alphabetic";
  theme.drawMulticolorText(ctx, String(value == null ? "" : value), x, y, {
    size,
    family: bold ? "JT-Round-Bold" : "JT-Round",
    color,
    align: align || "left",
    maxWidth,
    multicolor: true
  });
  ctx.restore();
}

function drawPeopleIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.3, theme.S(1.8));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.2, size * 0.19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.36, cy + size * 0.42);
  ctx.bezierCurveTo(
    cx - size * 0.35, cy + size * 0.05,
    cx + size * 0.35, cy + size * 0.05,
    cx + size * 0.36, cy + size * 0.42
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + size * 0.34, cy - size * 0.28, size * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + size * 0.47, cy + size * 0.08);
  ctx.quadraticCurveTo(cx + size * 0.66, cy + size * 0.08, cx + size * 0.68, cy + size * 0.34);
  ctx.stroke();
  ctx.restore();
}

function drawMember(ctx, name, x, y, palette, index, maxWidth) {
  const S = theme.S;
  const radius = S(17);
  const color = index % 2 === 0 ? palette.accent : "#a8a0ff";
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + radius, y - S(5), radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = S(1.2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  theme.drawMulticolorText(ctx, initials(name), x + radius, y, {
    size: 10,
    family: "JT-Round-Bold",
    color: palette.text,
    align: "center",
    maxWidth: radius * 1.5,
    multicolor: true
  });
  ctx.restore();

  drawText(ctx, name, x + S(46), y, 15, palette.text, true, "left", maxWidth - S(48));
}

function renderWelcomeCard(spec = {}) {
  theme.initFonts();
  theme.ensureTheme();

  const S = theme.S;
  const W = theme.WIDTH;
  const H = S(560);
  const { canvas, ctx } = theme.newCanvas(W, H);
  const palette = theme.getCardPalette();
  const mode = spec.mode === "status" ? "status" : "welcome";
  const names = normalizeNames(spec.memberNames);
  const visibleNames = names.slice(0, 4);
  const extraCount = Math.max(0, names.length - visibleNames.length);
  const margin = S(32);

  // Strict two-layer Canvas, matching /menu:
  // layer 1 = selected photo/theme background; layer 2 = transparent foreground content.
  // No outer shell, nested cards, glass panels or extra decorative overlays.
  theme.paintBackground(ctx, W, H, {
    veilAlpha: [0.025, 0.04, 0.055],
    vignetteAlpha: 0.055,
    auroraStrength: 0.22,
    sharpen: 0.42
  });

  const brandX = margin + S(38);
  drawPeopleIcon(ctx, margin + S(15), S(39), S(25), palette.accent);
  drawText(ctx, "JOHNTRAN-JS", brandX, S(36), 22, palette.text, true);
  drawText(
    ctx,
    mode === "status" ? "WELCOME SETTINGS" : "WELCOME  /  COMMUNITY",
    brandX,
    S(55),
    10.5,
    palette.muted,
    true
  );

  const rightLabel = mode === "status" ? "GROUP SETTINGS" : "NEW MEMBER";
  drawText(ctx, rightLabel, W - margin, S(47), 10, palette.accent, true, "right");

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(margin, S(79));
  ctx.lineTo(W - margin, S(79));
  ctx.strokeStyle = "rgba(98,220,255,.35)";
  ctx.lineWidth = Math.max(1, S(0.8));
  ctx.stroke();
  ctx.restore();

  const prefix = String(spec.prefix || global.config?.prefix || "/");
  const groupName = String(spec.groupName || "cộng đồng của chúng ta").trim();
  const botName = String(spec.botName || global.config?.name_bot || "JOHNTRAN");

  if (mode === "status") {
    drawText(ctx, "CHÀO MỪNG THÀNH VIÊN", margin, S(132), 27, palette.text, true, "left", W - margin * 2);
    drawText(ctx, groupName, margin, S(161), 15, palette.muted, false, "left", W - margin * 2);

    const enabled = Boolean(spec.enabled);
    const statusColor = enabled ? palette.green : palette.red;
    ctx.save();
    ctx.beginPath();
    ctx.arc(margin + S(10), S(222), S(6), 0, Math.PI * 2);
    ctx.fillStyle = statusColor;
    ctx.fill();
    ctx.restore();
    drawText(
      ctx,
      enabled ? "ĐANG BẬT  ·  BOT SẼ TỰ ĐỘNG CHÀO NGƯỜI MỚI" : "ĐANG TẮT  ·  BOT KHÔNG GỬI LỜI CHÀO",
      margin + S(28),
      S(227),
      14,
      statusColor,
      true,
      "left",
      W - margin * 2 - S(30)
    );
    drawText(ctx, prefix + "welcome on     ·  Bật lời chào", margin, S(310), 14, palette.text, true);
    drawText(ctx, prefix + "welcome off    ·  Tắt lời chào", margin, S(343), 14, palette.text, true);
    drawText(ctx, prefix + "welcome test   ·  Xem trước card", margin, S(376), 14, palette.text, true);
  } else {
    drawText(ctx, "CHÀO MỪNG THÀNH VIÊN MỚI", margin, S(132), 27, palette.text, true, "left", W - margin * 2);
    drawText(
      ctx,
      "Chào mừng bạn đến với " + groupName,
      margin,
      S(161),
      15,
      palette.muted,
      false,
      "left",
      W - margin * 2
    );

    drawText(ctx, "THÀNH VIÊN VỪA THAM GIA", margin, S(215), 10, palette.accent, true);

    const columnGap = S(24);
    const columnWidth = (W - margin * 2 - columnGap) / 2;
    const firstRowY = S(267);
    visibleNames.forEach((name, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + column * (columnWidth + columnGap);
      const y = firstRowY + row * S(57);
      drawMember(ctx, name, x, y, palette, index, columnWidth);
    });

    if (extraCount) {
      drawText(
        ctx,
        "+ " + extraCount + " thành viên khác",
        margin,
        firstRowY + S(2 * 57),
        12,
        palette.muted,
        true
      );
    }

    drawText(ctx, prefix + "menu  ·  Xem danh sách chức năng", margin, S(440), 13, palette.accent, true);
    drawText(ctx, "Đọc nội quy và làm quen với mọi người nhé!", margin, S(466), 12, palette.muted, false);
  }

  drawText(ctx, botName, W - margin, H - S(20), 9, palette.accent, true, "right");
  return theme.save(canvas, "welcome");
}

module.exports = { renderWelcomeCard, _test: { normalizeNames, initials } };
