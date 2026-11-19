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

function drawPill(ctx, x, y, width, height, color) {
  theme.roundRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = color + "22";
  ctx.fill();
  ctx.strokeStyle = color + "88";
  ctx.lineWidth = Math.max(1, theme.S(1));
  ctx.stroke();
}

function renderWelcomeCard(spec = {}) {
  theme.initFonts();
  theme.ensureTheme();

  const S = theme.S;
  const width = theme.WIDTH;
  const p = theme.getCardPalette();
  const mode = spec.mode === "status" ? "status" : "welcome";
  const names = normalizeNames(spec.memberNames);
  const visibleNames = names.slice(0, 4);
  const extraCount = Math.max(0, names.length - visibleNames.length);
  const memberRows = mode === "status" ? 1 : visibleNames.length + (extraCount ? 1 : 0);
  const height = S(510 + Math.max(0, memberRows - 1) * 34);
  const { canvas, ctx } = theme.newCanvas(width, height);

  theme.paintBackground(ctx, width, height, {
    veilAlpha: [0.31, 0.43, 0.56],
    auroraStrength: 0.88,
    vignetteAlpha: 0.28
  });

  const pad = S(24);
  theme.panel(ctx, pad, pad, width - pad * 2, height - pad * 2, S(24), p.accent);

  // A restrained decorative orbit makes this card different from regular VIP notices.
  ctx.save();
  ctx.globalAlpha = 0.26;
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = S(1.2);
  ctx.beginPath();
  ctx.arc(width / 2, S(118), S(52), Math.PI * 0.08, Math.PI * 0.92);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, S(118), S(61), Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.restore();

  theme.label(ctx, "JOHNTRAN  /  COMMUNITY", pad + S(26), S(56), {
    size: 10,
    color: p.accent,
    maxWidth: width - pad * 2 - S(52)
  });

  // Greeting emblem.
  const emblemY = S(120);
  const emblemRadius = S(32);
  const emblem = ctx.createLinearGradient(
    width / 2 - emblemRadius, emblemY - emblemRadius,
    width / 2 + emblemRadius, emblemY + emblemRadius
  );
  emblem.addColorStop(0, p.accent);
  emblem.addColorStop(1, "#8e9dff");
  ctx.beginPath();
  ctx.arc(width / 2, emblemY, emblemRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(4,16,32,.92)";
  ctx.fill();
  ctx.strokeStyle = emblem;
  ctx.lineWidth = S(2.5);
  ctx.stroke();
  theme.text(ctx, "HI", width / 2, emblemY + S(8), {
    size: 24,
    family: "JT-Mono-Bold",
    color: p.accent,
    align: "center",
    multicolor: false
  });

  const title = mode === "status" ? "WELCOME CONTROL" : "WELCOME";
  theme.text(ctx, title, width / 2, S(190), {
    size: mode === "status" ? 29 : 38,
    family: "JT-Display-Bold",
    color: p.ink,
    align: "center",
    maxWidth: width - S(100),
    multicolor: false
  });

  const subtitle = mode === "status"
    ? (spec.enabled ? "Hệ thống chào thành viên mới đang hoạt động" : "Hệ thống chào thành viên mới đang tạm tắt")
    : (spec.groupName ? "Chào mừng bạn đến với " + String(spec.groupName) : "Một thành viên mới vừa gia nhập cộng đồng");
  theme.text(ctx, subtitle, width / 2, S(218), {
    size: 13,
    color: p.ink2,
    align: "center",
    maxWidth: width - S(90),
    multicolor: false
  });

  const panelX = pad + S(18);
  const panelW = width - panelX * 2;
  const memberY = S(242);
  const memberH = S(mode === "status" ? 118 : 70 + memberRows * 38);
  theme.panel(ctx, panelX, memberY, panelW, memberH, S(15), p.accent);

  if (mode === "status") {
    theme.label(ctx, "TRẠNG THÁI HIỆN TẠI", panelX + S(22), memberY + S(27), {
      size: 9,
      color: p.mute
    });
    const statusColor = spec.enabled ? p.green : p.red;
    drawPill(ctx, panelX + S(22), memberY + S(43), S(154), S(40), statusColor);
    theme.text(ctx, spec.enabled ? "●  ĐANG BẬT" : "●  ĐANG TẮT", panelX + S(99), memberY + S(69), {
      size: 13,
      family: "JT-Bold",
      color: statusColor,
      align: "center",
      multicolor: false
    });
    theme.text(ctx, "Nhóm: " + String(spec.groupName || "Nhóm hiện tại"), panelX + S(196), memberY + S(68), {
      size: 12,
      color: p.ink2,
      maxWidth: panelW - S(220),
      multicolor: false
    });
  } else {
    theme.label(ctx, "THÀNH VIÊN MỚI", panelX + S(22), memberY + S(25), {
      size: 9,
      color: p.mute
    });
    visibleNames.forEach((name, index) => {
      const rowY = memberY + S(48 + index * 38);
      const avatarX = panelX + S(34);
      const avatarY = rowY - S(13);
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, S(13), 0, Math.PI * 2);
      ctx.fillStyle = index % 2 === 0 ? "rgba(98,220,255,.19)" : "rgba(151,133,255,.20)";
      ctx.fill();
      ctx.strokeStyle = index % 2 === 0 ? p.accent : "#a99cff";
      ctx.lineWidth = S(1);
      ctx.stroke();
      theme.text(ctx, initials(name), avatarX, avatarY + S(4), {
        size: 9,
        family: "JT-Bold",
        color: p.ink,
        align: "center",
        multicolor: false
      });
      theme.text(ctx, name, panelX + S(60), rowY + S(4), {
        size: 14,
        family: "JT-Bold",
        color: p.ink,
        maxWidth: panelW - S(88),
        multicolor: false
      });
    });
    if (extraCount) {
      const moreY = memberY + S(48 + visibleNames.length * 38);
      theme.text(ctx, "+ " + extraCount + " thành viên khác", panelX + S(60), moreY + S(4), {
        size: 12,
        color: p.muted,
        multicolor: false
      });
    }
  }

  const footerY = memberY + memberH + S(14);
  const footerH = S(91);
  theme.panel(ctx, panelX, footerY, panelW, footerH, S(15), p.accent);
  theme.label(ctx, mode === "status" ? "ĐIỀU KHIỂN NHANH" : "BẮT ĐẦU TẠI ĐÂY", panelX + S(22), footerY + S(25), {
    size: 9,
    color: p.accent
  });

  const prefix = String(spec.prefix || global.config?.prefix || "/");
  const lines = mode === "status"
    ? [prefix + "welcome on  ·  Bật chào mừng", prefix + "welcome off  ·  Tắt chào mừng", prefix + "welcome test  ·  Xem thử card"]
    : [prefix + "menu  ·  Xem danh sách lệnh", "Đọc nội quy và làm quen với mọi người nhé!"];
  lines.forEach((line, index) => {
    theme.text(ctx, line, panelX + S(22), footerY + S(49 + index * 18), {
      size: 11,
      color: p.ink2,
      maxWidth: panelW - S(44),
      multicolor: false
    });
  });

  theme.text(ctx, String(spec.botName || global.config?.name_bot || "JOHNTRAN"), width - pad - S(18), height - S(20), {
    size: 8,
    family: "JT-Mono",
    color: p.mute,
    align: "right",
    maxWidth: width - pad * 2 - S(36),
    multicolor: false
  });

  return theme.save(canvas, "welcome");
}

module.exports = { renderWelcomeCard, _test: { normalizeNames, initials } };
