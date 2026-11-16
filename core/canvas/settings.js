"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { withMacWindow } = require("./macWindow");
const theme = require("./theme");
const menuPalette = require("./menuPalette");

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
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(safeText(ctx, value, maxWidth), x, y);
  ctx.restore();
}

function rounded(ctx, x, y, width, height, radius) {
  theme.roundRect(ctx, x, y, width, height, radius);
}

function drawBackdrop(ctx, width, height, palette) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.background[0]);
  gradient.addColorStop(0.44, palette.background[1]);
  gradient.addColorStop(0.74, palette.background[2]);
  gradient.addColorStop(1, palette.background[3]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = (x, y, radius, color) => {
    const effect = ctx.createRadialGradient(x, y, 0, x, y, radius);
    effect.addColorStop(0, color);
    effect.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = effect;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.15, height * 0.08, width * 0.48, palette.glow[0]);
  glow(width * 0.9, height * 0.13, width * 0.4, palette.glow[1]);
  glow(width * 0.25, height * 0.95, width * 0.5, palette.glow[1]);
}

function drawPanel(ctx, x, y, width, height, palette) {
  rounded(ctx, x, y, width, height, S(12));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.24)";
  ctx.shadowBlur = S(8);
  ctx.shadowOffsetY = S(3);
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, palette.card[0]);
  gradient.addColorStop(1, palette.card[1]);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
  rounded(ctx, x, y, width, height, S(12));
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = Math.max(1, S(0.8));
  ctx.stroke();
}

function drawHeader(ctx, title, subtitle, meta, palette) {
  drawText(ctx, "JOHN TRAN  /  CONTROL CENTER", S(PAD), S(30), 10, palette.accent, true);
  drawText(ctx, title, S(PAD), S(62), 26, palette.text, true);
  drawText(ctx, subtitle, S(PAD), S(83), 11, palette.muted, false);
  drawText(ctx, meta || "", W - S(PAD), S(36), 10, palette.accent, true, "right", S(210));
}

function saveCard(canvas, title, palette) {
  const file = path.join(os.tmpdir(), "jt_settings_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(file, withMacWindow(canvas, title, palette).toBuffer("image/png"));
  return file;
}

function renderEventSettings(data = {}) {
  theme.initFonts();
  const palette = menuPalette.getPalette();
  const mode = data.mode === "hosts" ? "hosts" : "status";
  const events = Array.isArray(data.events) ? data.events.slice(0, 12) : [];
  const hosts = Array.isArray(data.hosts) ? data.hosts.slice(0, 24) : [];
  const rows = mode === "hosts" ? Math.max(1, hosts.length) : Math.max(1, events.length);
  const bodyHeight = S(mode === "hosts" ? 132 + rows * 37 : 135 + rows * 62);
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
    return saveCard(result.canvas, "Allowed Hosts", palette);
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
  return saveCard(result.canvas, "Group Events", palette);
}

function renderThemeSettings(data = {}) {
  theme.initFonts();
  const palette = menuPalette.getPalette();
  const presets = Array.isArray(data.presets) ? data.presets.slice(0, 8) : [];
  const rows = Math.max(1, Math.ceil(presets.length / 2));
  const bodyHeight = S(180 + rows * 118);
  const result = theme.newCanvas(W, bodyHeight);
  const ctx = result.ctx;
  drawBackdrop(ctx, W, bodyHeight, palette);
  const current = data.current || {};
  drawHeader(ctx, "MENU THEME", current.label || "Bảng màu giao diện",
    "ĐANG DÙNG: " + String(current.name || "gold").toUpperCase(), palette);

  const currentY = S(105);
  const currentX = S(PAD);
  const fullWidth = W - S(PAD * 2);
  drawPanel(ctx, currentX, currentY, fullWidth, S(62), palette);
  const swatch = String(current.accent || palette.accent);
  rounded(ctx, currentX + S(14), currentY + S(14), S(34), S(34), S(8));
  ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(swatch) ? swatch : palette.accent;
  ctx.fill();
  drawText(ctx, current.label || "Theme hiện tại", currentX + S(60), currentY + S(27), 11, palette.text, true);
  drawText(ctx, "Màu nhấn " + swatch, currentX + S(60), currentY + S(45), 8.5, palette.muted, false);

  const gap = S(10);
  const cardWidth = (fullWidth - gap) / 2;
  const cardY = currentY + S(76);
  presets.forEach((preset, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = currentX + col * (cardWidth + gap);
    const y = cardY + row * S(118);
    drawPanel(ctx, x, y, cardWidth, S(104), palette);
    const accent = /^#[0-9a-f]{6}$/i.test(String(preset.accent || "")) ? preset.accent : palette.accent;
    rounded(ctx, x + S(12), y + S(12), S(36), S(36), S(8));
    ctx.fillStyle = accent;
    ctx.fill();
    drawText(ctx, String(preset.name || "custom").toUpperCase(), x + S(58), y + S(28), 10, palette.text, true, "left", cardWidth - S(72));
    drawText(ctx, preset.label || "Màu tùy chỉnh", x + S(58), y + S(45), 8, palette.muted, false, "left", cardWidth - S(72));
    drawText(ctx, accent.toLowerCase(), x + S(13), y + S(70), 9, palette.accent, true);
    const selected = String(current.name || "").toLowerCase() === String(preset.name || "").toLowerCase();
    drawText(ctx, selected ? "ĐANG DÙNG" : "GÕ /theme " + (preset.name || "custom"),
      x + S(13), y + S(89), 8, selected ? "#7de0ab" : palette.muted, true, "left", cardWidth - S(24));
  });

  drawText(ctx, "Tùy chỉnh: /theme #RRGGBB  ·  Mặc định: /theme reset",
    currentX + S(4), bodyHeight - S(22), 8.5, palette.muted, false, "left", fullWidth - S(8));
  return saveCard(result.canvas, "Menu Theme", palette);
}

module.exports = { renderEventSettings, renderThemeSettings };
