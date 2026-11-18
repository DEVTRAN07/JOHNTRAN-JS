"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const theme = require("./theme");
const themeBackgrounds = require("./themeBackgrounds");

const S = theme.S;
const W = theme.WIDTH;
const PAD = 28;

function safeText(ctx, value, maxWidth) {
  let result = theme.sanitizeGlyphs(String(value == null ? "" : value));
  if (!maxWidth || ctx.measureText(result).width <= maxWidth) return result;
  while (result.length > 1 && ctx.measureText(result + "…").width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + "…";
}

function drawText(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save();
  ctx.font = theme.font(size, bold ? "JT-Round-Bold" : "JT-Round");
  const accentText = color === theme.PALETTE.accent || color === theme.PALETTE.accent2;
  ctx.fillStyle = accentText ? theme.randomTextColor(String(value) + ":" + x + ":" + y) : color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(safeText(ctx, value, maxWidth), x, y);
  ctx.restore();
}

function rounded(ctx, x, y, width, height, radius) {
  theme.roundRect(ctx, x, y, width, height, radius);
}

function drawBackdrop(ctx, width, height, palette) {
  // Settings, admin and Anti cards share the same starfield + glass shell.
  theme.paintBackground(ctx, width, height);
}

function drawPanel(ctx, x, y, width, height, palette) {
  theme.panel(ctx, x, y, width, height, S(12), palette?.accent || theme.PALETTE.accent);
}

function drawHeader(ctx, title, subtitle, meta, palette) {
  drawText(ctx, "JOHN TRAN  /  CONTROL CENTER", S(PAD), S(30), 10, palette.accent, true);
  drawText(ctx, title, S(PAD), S(62), 26, palette.text, true);
  drawText(ctx, subtitle, S(PAD), S(83), 11, palette.muted, false);
  drawText(ctx, meta || "", W - S(PAD), S(36), 10, palette.accent, true, "right", S(210));
}

function saveCard(canvas) {
  const file = path.join(os.tmpdir(), "jt_settings_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  return file;
}

function renderEventSettings(data = {}) {
  theme.initFonts();
  const palette = theme.getCardPalette();
  const mode = data.mode === "hosts" ? "hosts" : "status";
  const events = Array.isArray(data.events) ? data.events.slice(0, 12) : [];
  const hosts = Array.isArray(data.hosts) ? data.hosts.slice(0, 24) : [];
  const rows = mode === "hosts" ? Math.max(1, hosts.length) : Math.max(1, events.length);
  const bodyHeight = S(mode === "hosts" ? 182 + rows * 37 : 178 + rows * 68);
  const result = theme.newCanvas(W, bodyHeight);
  const ctx = result.ctx;
  drawBackdrop(ctx, W, bodyHeight, palette);

  if (mode === "hosts") {
    drawHeader(ctx, "HOST ĐƯỢC PHÉP", "Danh sách ngoại lệ cho bộ lọc Guard", String(hosts.length) + " HOST", palette);
    const x = S(PAD), y = S(105), width = W - S(PAD * 2);
    const panelHeight = bodyHeight - y - S(22);
    drawPanel(ctx, x, y, width, panelHeight, palette);
    drawText(ctx, "DANH SÁCH AN TOÀN", x + S(16), y + S(27), 10, palette.accent, true);
    const shown = hosts.length ? hosts : ["Chưa thêm host nào · bot dùng danh sách mặc định"];
    shown.forEach((host, index) => {
      const rowY = y + S(55 + index * 37);
      if (index > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.07)";
        ctx.beginPath();
        ctx.moveTo(x + S(15), rowY - S(18));
        ctx.lineTo(x + width - S(15), rowY - S(18));
        ctx.stroke();
        ctx.restore();
      }
      drawText(ctx, hosts.length ? String(index + 1).padStart(2, "0") : "—", x + S(17), rowY, 9, palette.accent, true);
      drawText(ctx, host, x + S(49), rowY, 11, palette.text, false, "left", width - S(80));
    });
    drawText(ctx, "Thêm host: " + String(data.prefix || "/") + "events guard allow <host>",
      x + S(16), bodyHeight - S(28), 8.5, palette.muted, false, "left", width - S(30));
    return saveCard(result.canvas);
  }

  drawHeader(ctx, "SỰ KIỆN NHÓM", "Trạng thái tự động trong nhóm hiện tại", String(events.length) + " MODULE", palette);
  const x = S(PAD), y = S(105), width = W - S(PAD * 2);
  const panelHeight = bodyHeight - y - S(22);
  drawPanel(ctx, x, y, width, panelHeight, palette);
  drawText(ctx, "MODULE", x + S(16), y + S(28), 9, palette.muted, true);
  drawText(ctx, "TRẠNG THÁI", x + width - S(17), y + S(28), 9, palette.muted, true, "right");
  const shown = events.length ? events : [{ key: "none", label: "Chưa có sự kiện", enabled: false }];
  shown.forEach((item, index) => {
    const rowY = y + S(67 + index * 62);
    if (index > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.07)";
      ctx.beginPath();
      ctx.moveTo(x + S(15), rowY - S(29));
      ctx.lineTo(x + width - S(15), rowY - S(29));
      ctx.stroke();
      ctx.restore();
    }
    drawText(ctx, item.label || item.key, x + S(17), rowY - S(4), 12, palette.text, true, "left", width - S(190));
    drawText(ctx, "/" + String(item.key || ""), x + S(17), rowY + S(15), 8, palette.muted, false);
    const enabled = Boolean(item.enabled);
    const pillWidth = S(108), pillHeight = S(27);
    const pillX = x + width - S(17) - pillWidth;
    const pillY = rowY - S(19);
    rounded(ctx, pillX, pillY, pillWidth, pillHeight, S(8));
    ctx.fillStyle = enabled ? "rgba(67,190,130,.17)" : "rgba(204,105,105,.14)";
    ctx.fill();
    ctx.strokeStyle = enabled ? "#55c58b" : "#d77e7e";
    ctx.lineWidth = Math.max(1, S(0.8));
    ctx.stroke();
    drawText(ctx, enabled ? "ĐANG BẬT" : "ĐANG TẮT", pillX + pillWidth / 2, pillY + S(18),
      8.5, enabled ? "#7de0ab" : "#ee9a9a", true, "center", pillWidth - S(10));
  });

  drawText(ctx, "Bật/tắt: " + String(data.prefix || "/") + "events <tên> on|off",
    x + S(16), bodyHeight - S(28), 8.5, palette.muted, false, "left", width - S(30));
  return saveCard(result.canvas);
}

function renderThemeSettings(data = {}) {
  theme.initFonts();
  const palette = theme.getCardPalette();
  const current = themeBackgrounds.getCurrent();
  const backgrounds = themeBackgrounds.getBackgrounds();
  const margin = S(24);
  const gap = S(13);
  const headerY = S(22);
  const headerH = S(86);
  const cardsY = headerY + headerH + S(20);
  const cardW = (W - margin * 2 - gap * 2) / 3;
  const cardH = S(360);
  const footerY = cardsY + cardH + S(18);
  const height = footerY + S(88);

  const result = theme.newCanvas(W, height);
  const ctx = result.ctx;
  drawBackdrop(ctx, W, height, palette);

  theme.panel(ctx, margin, headerY, W - margin * 2, headerH, S(16), palette.accent);
  drawText(ctx, "JOHNTRAN  /  PHOTO THEME LIBRARY",
    margin + S(18), headerY + S(28), 9, palette.accent, true);
  drawText(ctx, "AURORA CYBER BACKGROUNDS",
    margin + S(18), headerY + S(57), 21, palette.text, true);
  drawText(ctx, current.random ? "RANDOM ROTATION" : "ĐANG CHỌN ẢNH " + current.selected,
    W - margin - S(18), headerY + S(54), 9, palette.accent, true, "right");

  backgrounds.forEach((background, index) => {
    const x = margin + index * (cardW + gap);
    const y = cardsY;
    const image = themeBackgrounds.getImage(background.id);
    const isSelected = background.id === current.selected;
    theme.panel(ctx, x, y, cardW, cardH, S(16), palette.accent);

    const thumbX = x + S(8);
    const thumbY = y + S(8);
    const thumbW = cardW - S(16);
    const thumbH = cardH - S(16);
    rounded(ctx, thumbX, thumbY, thumbW, thumbH, S(12));
    ctx.save();
    ctx.clip();
    if (image) {
      const scale = Math.max(thumbW / image.width, thumbH / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      ctx.drawImage(image, thumbX + (thumbW - drawWidth) / 2,
        thumbY + (thumbH - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      const fallback = ctx.createLinearGradient(thumbX, thumbY, thumbX + thumbW, thumbY + thumbH);
      fallback.addColorStop(0, "#07182d");
      fallback.addColorStop(.52, "#123c5c");
      fallback.addColorStop(1, "#251d4d");
      ctx.fillStyle = fallback;
      ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
      drawText(ctx, "ẢNH SẼ TẢI KHI BOT CÓ KẾT NỐI",
        thumbX + thumbW / 2, thumbY + thumbH / 2, 8, palette.text, true, "center", thumbW - S(18));
    }

    const photoShade = ctx.createLinearGradient(0, thumbY + thumbH * .40, 0, thumbY + thumbH);
    photoShade.addColorStop(0, "rgba(2,8,18,0)");
    photoShade.addColorStop(.60, "rgba(2,8,18,.24)");
    photoShade.addColorStop(1, "rgba(2,8,18,.90)");
    ctx.fillStyle = photoShade;
    ctx.fillRect(thumbX, thumbY, thumbW, thumbH);

    // Small Aurora haze and cyan edge make the photo preview read as a theme card.
    const haze = ctx.createRadialGradient(
      thumbX + thumbW * .78, thumbY + thumbH * .20, 0,
      thumbX + thumbW * .78, thumbY + thumbH * .20, thumbW * .70
    );
    haze.addColorStop(0, "rgba(56,220,255,.25)");
    haze.addColorStop(1, "rgba(56,220,255,0)");
    ctx.fillStyle = haze;
    ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
    ctx.restore();

    rounded(ctx, thumbX, thumbY, thumbW, thumbH, S(12));
    ctx.strokeStyle = background.id === current.selected
      ? "rgba(110,255,230,.95)" : "rgba(98,220,255,.70)";
    ctx.lineWidth = isSelected ? S(2.2) : S(1);
    ctx.shadowColor = "rgba(47,220,255,.72)";
    ctx.shadowBlur = S(9);
    ctx.stroke();
    ctx.shadowBlur = 0;

    rounded(ctx, thumbX + S(10), thumbY + S(10), S(34), S(28), S(9));
    ctx.fillStyle = "rgba(4,14,30,.72)";
    ctx.fill();
    drawText(ctx, background.id, thumbX + S(27), thumbY + S(29),
      12, palette.accent, true, "center");

    drawText(ctx, background.name.toUpperCase(),
      thumbX + S(13), thumbY + thumbH - S(60), 10,
      theme.randomTextColor(background.id + ":theme-title"), true,
      "left", thumbW - S(26));
    drawText(ctx, "NỀN ẢNH  /  AURORA CYBER",
      thumbX + S(13), thumbY + thumbH - S(40), 7.4,
      palette.text, true);
    drawText(ctx, isSelected ? "ĐANG CHỌN" : "GÕ /theme " + background.id,
      thumbX + S(13), thumbY + thumbH - S(18), 8.5,
      isSelected ? "#8dffe8" : palette.accent, true);
  });

  theme.panel(ctx, margin, footerY, W - margin * 2, S(70), S(14), palette.accent);
  drawText(ctx, "CHỌN NỀN:  /theme 1  ·  /theme 2  ·  /theme 3",
    margin + S(17), footerY + S(27), 10, palette.accent, true);
  drawText(ctx, "NGẪU NHIÊN: /theme random  ·  TIẾP THEO: /theme next  ·  RESET: /theme reset",
    margin + S(17), footerY + S(49), 8.2, palette.text, false);

  return saveCard(result.canvas);
}


function renderAdminCard(data = {}) {
  theme.initFonts();
  const palette = theme.getCardPalette();
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const layouts = sections.map(section => {
    const items = Array.isArray(section.items) && section.items.length
      ? section.items
      : [{ name: "Không có dữ liệu", uid: "" }];
    return { section, items, height: S(44 + items.length * 43 + 13) };
  });
  let y = S(105);
  const positions = [];
  for (const layout of layouts) {
    positions.push(y);
    y += layout.height + S(12);
  }
  const height = y + S(34);
  const result = theme.newCanvas(W, height);
  const ctx = result.ctx;
  drawBackdrop(ctx, W, height, palette);
  drawHeader(ctx, data.title || "QUẢN LÝ ADMIN", data.subtitle || "Quản trị và phân quyền bot",
    data.meta || "ADMIN CONTROL", palette);

  layouts.forEach((layout, sectionIndex) => {
    const x = S(PAD);
    const sectionY = positions[sectionIndex];
    const width = W - S(PAD * 2);
    drawPanel(ctx, x, sectionY, width, layout.height, palette);
    drawText(ctx, layout.section.title || "DANH SÁCH", x + S(15), sectionY + S(26), 10, palette.accent, true);
    drawText(ctx, String(layout.items.length).padStart(2, "0") + " MỤC",
      x + width - S(15), sectionY + S(26), 8, palette.muted, true, "right");
    layout.items.forEach((item, index) => {
      const rowY = sectionY + S(54 + index * 43);
      if (index > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.07)";
        ctx.beginPath();
        ctx.moveTo(x + S(14), rowY - S(20));
        ctx.lineTo(x + width - S(14), rowY - S(20));
        ctx.stroke();
        ctx.restore();
      }
      drawText(ctx, String(index + 1).padStart(2, "0"), x + S(16), rowY, 8, palette.accent, true);
      drawText(ctx, item.name || "Không rõ", x + S(48), rowY, 11, palette.text, true, "left", width - S(72));
      if (item.uid) {
        drawText(ctx, item.uid, x + S(48), rowY + S(15), 8.5, palette.muted, false, "left", width - S(72));
      }
    });
  });

  const footerY = height - S(32);
  drawPanel(ctx, S(PAD), footerY, W - S(PAD * 2), S(25), palette, palette.footer);
  drawText(ctx, data.footer || "JOHNTRAN  ·  ADMIN CONTROL",
    S(PAD + 12), footerY + S(17), 8, palette.muted, false, "left", W - S(PAD * 2 + 24));
  return saveCard(result.canvas);
}

function renderAntiProtectionCard(data = {}) {
  // Legacy worker aliases use the same current design as Anti V2.
  return renderAntiProtectionCardV2(data);
}
function renderAntiProtectionCardV2(data = {}) {
  theme.initFonts();
  const palette = theme.getCardPalette();
  const items = Array.isArray(data.items) ? data.items.slice(0, 8) : [];
  const columns = 2;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const margin = S(22);
  const gapX = S(12);
  const gapY = S(10);
  const bannerY = S(18);
  const bannerH = S(70);
  const cardH = S(76);
  const startY = bannerY + bannerH + S(16);
  const cardW = (W - margin * 2 - gapX) / columns;
  const infoY = startY + rows * cardH + Math.max(0, rows - 1) * gapY + S(14);
  // Keep the permission guidance as lightweight text over the photo instead
  // of another large opaque panel. The board height now follows its content.
  const footerY = infoY + S(70);
  const height = footerY + S(24);

  const result = theme.newCanvas(W, height);
  const ctx = result.ctx;
  theme.paintBackground(ctx, W, height);

  // Header is a light translucent title strip; the photo remains visible below.
  theme.panel(ctx, margin, bannerY, W - margin * 2, bannerH, S(16), palette.accent);
  const iconX = margin + S(15);
  const iconY = bannerY + S(13);
  theme.roundRect(ctx, iconX, iconY, S(44), S(44), S(11));
  ctx.fillStyle = palette.infoFill;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(1, S(1));
  ctx.stroke();
  drawText(ctx, "+", iconX + S(22), iconY + S(31), 26, palette.accent, true, "center");

  drawText(ctx, "BẢO VỆ NHÓM",
    margin + S(82), bannerY + S(39), 20, palette.text, true,
    "left", W - margin * 2 - S(210));
  drawText(ctx, "6 CHẾ ĐỘ · TRẠNG THÁI ON / OFF",
    margin + S(82), bannerY + S(56), 8.5, palette.muted, true,
    "left", W - margin * 2 - S(210));

  const activeCount = items.filter(item => item.enabled === true).length;
  const badgeW = S(112), badgeH = S(29);
  const badgeX = W - margin - badgeW - S(14);
  const badgeY = bannerY + (bannerH - badgeH) / 2;
  theme.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = palette.infoFill;
  ctx.fill();
  ctx.strokeStyle = palette.infoBorder;
  ctx.lineWidth = Math.max(1, S(.8));
  ctx.stroke();
  drawText(ctx, activeCount + "/" + items.length + " ĐANG BẬT",
    badgeX + badgeW / 2, badgeY + S(19), 8.2,
    palette.accent, true, "center", badgeW - S(10));

  // Each Anti mode is a separate raised module, matching menu category tiles.
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    theme.panel(ctx, x, y, cardW, cardH, S(13), palette.accent);

    const iconX = x + S(11);
    const iconY = y + S(18);
    const iconSize = S(39);
    theme.roundRect(ctx, iconX, iconY, iconSize, iconSize, S(11));
    ctx.fillStyle = String(item.tone || palette.accent);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.24)";
    ctx.lineWidth = Math.max(1, S(.7));
    ctx.stroke();
    drawText(ctx, item.icon || "•", iconX + iconSize / 2,
      iconY + S(25), 12, "#ffffff", true, "center", iconSize - S(5));

    const textX = x + S(58);
    const textWidth = cardW - S(125);
    drawText(ctx, item.label || item.key || "Anti",
      textX, y + S(28), 10.5, palette.text, true, "left", textWidth);
    drawText(ctx, item.detail || "Chế độ bảo vệ nhóm",
      textX, y + S(44), 7.1, palette.muted, false, "left", textWidth);
    const enabled = item.enabled === true;
    drawText(ctx, enabled ? "✓ ĐANG BẬT" : "○ ĐANG TẮT",
      textX, y + S(62), 7.4, enabled ? palette.green : palette.muted,
      true, "left", textWidth);

    if (enabled) {
      const badgeX = iconX + iconSize - S(2);
      const badgeY = iconY + S(1);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, S(8), 0, Math.PI * 2);
      ctx.fillStyle = palette.green;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(badgeX - S(4), badgeY);
      ctx.lineTo(badgeX - S(1), badgeY + S(3));
      ctx.lineTo(badgeX + S(4), badgeY - S(3));
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, S(1.5));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    const switchW = S(36), switchH = S(21);
    const switchX = x + cardW - S(47);
    const switchY = y + (cardH - switchH) / 2;
    theme.roundRect(ctx, switchX, switchY, switchW, switchH, switchH / 2);
    ctx.fillStyle = enabled ? palette.accent : "rgba(255,255,255,.08)";
    ctx.fill();
    ctx.strokeStyle = enabled ? palette.accent : palette.cardBorder;
    ctx.lineWidth = Math.max(1, S(.8));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      enabled ? switchX + switchW - S(11) : switchX + S(11),
      switchY + switchH / 2,
      S(7.5), 0, Math.PI * 2
    );
    ctx.fillStyle = "#f5f8ff";
    ctx.fill();
  });

  // Permission guidance is rendered directly over the wallpaper,
  // avoiding a second large panel that used to hide most of the photo.
  drawText(ctx, "ĐIỀU KIỆN: BOT PHẢI LÀ TRƯỞNG NHÓM / PHÓ NHÓM (QTV BOX).",
    margin + S(2), infoY + S(17), 8.5, palette.accent, true,
    "left", W - margin * 2 - S(8));
  drawText(ctx, "Không có QTV: Anti tự bỏ qua; có QTV trở lại sẽ chạy theo cấu hình đã lưu.",
    margin + S(2), infoY + S(36), 8.1, palette.muted, false,
    "left", W - margin * 2 - S(8));
  drawText(ctx, "Mọi thành viên đều chịu Anti · Chỉ QTV nhóm được thay đổi cấu hình.",
    margin + S(2), infoY + S(54), 8.1, palette.ink2, false,
    "left", W - margin * 2 - S(8));

  drawText(ctx, "JOHNTRAN  ·  ANTI-PROTECTION",
    margin + S(2), footerY, 8, palette.muted, true);
  drawText(ctx, "LIVE STATUS",
    W - margin - S(2), footerY, 7.5, palette.accent, true, "right");

  const output = path.join(os.tmpdir(),
    "jt_anti_protection_v2_" + Date.now() + "_" +
    Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(output, result.canvas.toBuffer("image/png"));
  return output;
}

module.exports = { renderEventSettings, renderThemeSettings, renderAdminCard, renderAntiProtectionCard, renderAntiProtectionCardV2 };
