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
  const bodyHeight = S(220 + rows * 118);
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



function renderAdminCard(data = {}) {
  theme.initFonts();
  const palette = menuPalette.getPalette();
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
  return saveCard(result.canvas, data.title || "Admin Control", palette);
}

function renderAntiProtectionCard(data = {}) {
  theme.initFonts();
  const palette = menuPalette.getPalette();
  const items = Array.isArray(data.items) ? data.items.slice(0, 8) : [];
  const columns = 2;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const cardHeight = S(70);
  const gapX = S(10);
  const gapY = S(9);
  const bodyHeight = S(185) + rows * cardHeight + Math.max(0, rows - 1) * gapY + S(48);
  const result = theme.newCanvas(W, bodyHeight);
  const ctx = result.ctx;
  drawBackdrop(ctx, W, bodyHeight, palette);

  const bannerX = S(18);
  const bannerY = S(16);
  const bannerW = W - bannerX * 2;
  const bannerH = S(83);
  rounded(ctx, bannerX, bannerY, bannerW, bannerH, S(15));
  const banner = ctx.createLinearGradient(bannerX, bannerY, bannerX + bannerW, bannerY + bannerH);
  banner.addColorStop(0, "#0b3157");
  banner.addColorStop(0.58, "#104978");
  banner.addColorStop(1, "#0b345d");
  ctx.fillStyle = banner;
  ctx.fill();
  rounded(ctx, bannerX, bannerY, bannerW, bannerH, S(15));
  ctx.strokeStyle = "rgba(111,190,235,.5)";
  ctx.lineWidth = S(1);
  ctx.stroke();

  rounded(ctx, bannerX + S(15), bannerY + S(16), S(50), S(50), S(10));
  ctx.fillStyle = "#05b9d8";
  ctx.fill();
  drawText(ctx, "+", bannerX + S(40), bannerY + S(49), 31, "#ffffff", true, "center");
  drawText(ctx, "Bảo vệ nhóm (Anti-Protection)", bannerX + S(79), bannerY + S(39),
    20, "#f7fbff", true, "left", bannerW - S(205));
  drawText(ctx, "Bảo vệ nhóm", bannerX + S(80), bannerY + S(61),
    11, "#cfe6f5", false, "left", bannerW - S(205));
  drawText(ctx, String(items.length) + " CHẾ ĐỘ", bannerX + bannerW - S(16), bannerY + S(48),
    9, "#d1ebfa", true, "right", S(110));

  const margin = S(18);
  const contentW = W - margin * 2;
  const cardW = (contentW - gapX) / columns;
  const startY = bannerY + bannerH + S(14);
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (cardW + gapX);
    const y = startY + row * (cardHeight + gapY);
    rounded(ctx, x, y, cardW, cardHeight, S(11));
    const fill = ctx.createLinearGradient(x, y, x + cardW, y + cardHeight);
    fill.addColorStop(0, "#30384a");
    fill.addColorStop(1, "#242e42");
    ctx.fillStyle = fill;
    ctx.fill();
    rounded(ctx, x, y, cardW, cardHeight, S(11));
    ctx.strokeStyle = "rgba(175,191,210,.52)";
    ctx.lineWidth = S(.75);
    ctx.stroke();

    rounded(ctx, x + S(9), y + S(15), S(39), S(39), S(9));
    ctx.fillStyle = String(item.tone || "#168fe9");
    ctx.fill();
    drawText(ctx, item.icon || "•", x + S(28.5), y + S(40), 13,
      "#ffffff", true, "center", S(34));

    drawText(ctx, item.label || item.key || "Anti", x + S(58), y + S(29),
      11.5, "#f7f8fc", true, "left", cardW - S(120));
    drawText(ctx, item.enabled === true ? "ĐANG BẬT" : "ĐANG TẮT",
      x + S(58), y + S(47), 7.5, item.enabled === true ? "#67e3b0" : "#c3cad5",
      true, "left", cardW - S(120));

    const switchW = S(43);
    const switchH = S(24);
    const switchX = x + cardW - S(53);
    const switchY = y + (cardHeight - switchH) / 2;
    rounded(ctx, switchX, switchY, switchW, switchH, switchH / 2);
    ctx.fillStyle = item.enabled === true ? "#08bce8" : "#303846";
    ctx.fill();
    ctx.strokeStyle = item.enabled === true ? "#3ed4f5" : "#697589";
    ctx.lineWidth = S(.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      item.enabled === true ? switchX + switchW - S(12) : switchX + S(12),
      switchY + switchH / 2,
      S(9),
      0,
      Math.PI * 2
    );
    ctx.fillStyle = "#f5f8fc";
    ctx.fill();
  });

  const footerY = bodyHeight - S(33);
  drawText(ctx, String(items.filter(item => item.enabled === true).length) + "/" +
    String(items.length) + " chế độ đang bật",
    margin, footerY, 9, "#effaff", true);
  drawText(ctx, "QTV BOX · ON / OFF",
    W - margin, footerY, 8, "#d4e8f5", true, "right");
  return saveCard(result.canvas, "Anti Protection", palette);
}


function renderAntiProtectionCardV2(data = {}) {
  theme.initFonts();
  const items = Array.isArray(data.items) ? data.items.slice(0, 8) : [];
  const width = W;
  const height = S(720);
  const result = theme.newCanvas(width, height);
  const ctx = result.ctx;

  // Dedicated Anti visual identity: do not inherit the old Mac-window frame
  // or the menu's saved gold/black theme.
  const background = ctx.createLinearGradient(0, 0, width * 0.85, height);
  background.addColorStop(0, "#c2b9a3");
  background.addColorStop(0.26, "#78999a");
  background.addColorStop(0.58, "#246f91");
  background.addColorStop(1, "#0866a8");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.08, height * 0.03, width * 0.52, "rgba(255,225,175,.46)");
  glow(width * 0.97, height * 0.2, width * 0.43, "rgba(15,191,220,.28)");
  glow(width * 0.68, height * 0.96, width * 0.55, "rgba(0,95,190,.34)");

  const margin = S(22);
  const bannerX = margin;
  const bannerY = S(18);
  const bannerW = width - margin * 2;
  const bannerH = S(88);
  rounded(ctx, bannerX, bannerY, bannerW, bannerH, S(15));
  ctx.save();
  ctx.shadowColor = "rgba(4,22,42,.32)";
  ctx.shadowBlur = S(14);
  ctx.shadowOffsetY = S(5);
  const banner = ctx.createLinearGradient(bannerX, bannerY, bannerX + bannerW, bannerY + bannerH);
  banner.addColorStop(0, "#0a3157");
  banner.addColorStop(.57, "#104b7b");
  banner.addColorStop(1, "#0a355e");
  ctx.fillStyle = banner;
  ctx.fill();
  ctx.restore();
  rounded(ctx, bannerX, bannerY, bannerW, bannerH, S(15));
  ctx.strokeStyle = "rgba(139,205,239,.68)";
  ctx.lineWidth = S(1);
  ctx.stroke();

  rounded(ctx, bannerX + S(15), bannerY + S(17), S(53), S(53), S(10));
  ctx.fillStyle = "#05b8d7";
  ctx.fill();
  drawText(ctx, "+", bannerX + S(41.5), bannerY + S(54), 34, "#ffffff", true, "center");
  drawText(ctx, "Bảo vệ nhóm (Anti-Protection)",
    bannerX + S(83), bannerY + S(40), 22, "#f8fbff", true, "left", bannerW - S(220));
  drawText(ctx, "BẢO VỆ NHÓM · TRẠNG THÁI THỰC TẾ",
    bannerX + S(84), bannerY + S(63), 9, "#cde7f7", true, "left", bannerW - S(220));

  const activeCount = items.filter(item => item.enabled === true).length;
  const badgeW = S(105), badgeH = S(30);
  const badgeX = bannerX + bannerW - badgeW - S(17);
  const badgeY = bannerY + (bannerH - badgeH) / 2;
  rounded(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = "rgba(5,191,226,.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(113,220,246,.72)";
  ctx.lineWidth = S(.8);
  ctx.stroke();
  drawText(ctx, activeCount + "/" + items.length + " ĐANG BẬT",
    badgeX + badgeW / 2, badgeY + S(19), 8.5, "#e9faff", true, "center", badgeW - S(10));

  const columns = 2;
  const gapX = S(10);
  const gapY = S(11);
  const cardHeight = S(92);
  const cardW = (width - margin * 2 - gapX) / columns;
  const startY = S(121);

  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + column * (cardW + gapX);
    const y = startY + row * (cardHeight + gapY);

    rounded(ctx, x, y + S(3), cardW, cardHeight, S(11));
    ctx.save();
    ctx.shadowColor = "rgba(5,19,34,.25)";
    ctx.shadowBlur = S(7);
    ctx.shadowOffsetY = S(3);
    const card = ctx.createLinearGradient(x, y, x + cardW, y + cardHeight);
    card.addColorStop(0, "#30394b");
    card.addColorStop(1, "#252f43");
    ctx.fillStyle = card;
    ctx.fill();
    ctx.restore();
    rounded(ctx, x, y + S(3), cardW, cardHeight, S(11));
    ctx.strokeStyle = "rgba(185,201,220,.68)";
    ctx.lineWidth = S(.8);
    ctx.stroke();

    const iconX = x + S(11);
    const iconY = y + S(21);
    rounded(ctx, iconX, iconY, S(43), S(43), S(10));
    ctx.fillStyle = String(item.tone || "#168fe9");
    ctx.fill();
    drawText(ctx, item.icon || "•", iconX + S(21.5), iconY + S(28),
      14, "#ffffff", true, "center", S(38));

    const textX = x + S(65);
    const textWidth = cardW - S(146);
    drawText(ctx, item.label || item.key || "Anti",
      textX, y + S(39), 13.5, "#f7f9fd", true, "left", textWidth);
    drawText(ctx, item.detail || "Chế độ bảo vệ nhóm",
      textX, y + S(57), 8.1, "#c5cfdd", false, "left", textWidth);
    drawText(ctx, item.enabled === true ? "✓ ĐANG BẬT" : "○ ĐANG TẮT",
      textX, y + S(76), 7.6, item.enabled === true ? "#74e2b4" : "#adb8c8",
      true, "left", textWidth);

    // Enabled features also receive an explicit green check badge on the icon,
    // so the image remains readable even in a compressed Zalo chat preview.
    if (item.enabled === true) {
      const badgeX = iconX + S(40);
      const badgeY = iconY + S(3);
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, S(8), 0, Math.PI * 2);
      ctx.fillStyle = "#16bf83";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(badgeX - S(4), badgeY);
      ctx.lineTo(badgeX - S(1), badgeY + S(3));
      ctx.lineTo(badgeX + S(4), badgeY - S(3));
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, S(1.6));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    const switchW = S(43);
    const switchH = S(24);
    const switchX = x + cardW - S(52);
    const switchY = y + S(37);
    rounded(ctx, switchX, switchY, switchW, switchH, switchH / 2);
    ctx.fillStyle = item.enabled === true ? "#08bde8" : "#343e50";
    ctx.fill();
    ctx.strokeStyle = item.enabled === true ? "#49dcf8" : "#7a8799";
    ctx.lineWidth = S(.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(
      item.enabled === true ? switchX + switchW - S(12) : switchX + S(12),
      switchY + switchH / 2,
      S(9),
      0,
      Math.PI * 2
    );
    ctx.fillStyle = "#f5f8fc";
    ctx.fill();
  });

  const infoY = S(441);
  const infoH = S(151);
  rounded(ctx, margin, infoY, width - margin * 2, infoH, S(13));
  const infoGradient = ctx.createLinearGradient(margin, infoY, width - margin, infoY + infoH);
  infoGradient.addColorStop(0, "rgba(10,48,79,.93)");
  infoGradient.addColorStop(1, "rgba(15,71,107,.94)");
  ctx.fillStyle = infoGradient;
  ctx.fill();
  rounded(ctx, margin, infoY, width - margin * 2, infoH, S(13));
  ctx.strokeStyle = "rgba(141,206,238,.55)";
  ctx.lineWidth = S(.8);
  ctx.stroke();

  drawText(ctx, "QUYỀN QUẢN LÝ · QTV BOX",
    margin + S(17), infoY + S(29), 10, "#8feaff", true);
  drawText(ctx, "Chỉ trưởng nhóm hoặc phó nhóm được bật / tắt",
    margin + S(17), infoY + S(59), 13.5, "#f6fbff", true,
    "left", width - margin * 2 - S(34));
  drawText(ctx, "Trạng thái được lưu riêng cho từng nhóm Zalo.",
    margin + S(17), infoY + S(83), 10, "#c9e2f1", false,
    "left", width - margin * 2 - S(34));
  drawText(ctx, "CÚ PHÁP VÀ HƯỚNG DẪN CHI TIẾT NẰM Ở TIN NHẮN NGAY BÊN DƯỚI ẢNH",
    margin + S(17), infoY + S(117), 8, "#a8d9ed", true,
    "left", width - margin * 2 - S(34));

  const footerY = S(628);
  drawText(ctx, "JOHNTRAN · ANTI-PROTECTION V2",
    margin + S(3), footerY, 8.5, "#f0fbff", true);
  drawText(ctx, "LIVE GROUP STATUS",
    width - margin - S(3), footerY, 8, "#d7f3fb", true, "right");

  const output = path.join(os.tmpdir(),
    "jt_anti_protection_v2_" + Date.now() + "_" +
    Math.random().toString(36).slice(2, 7) + ".png");
  fs.writeFileSync(output, result.canvas.toBuffer("image/png"));
  return output;
}

module.exports = { renderEventSettings, renderThemeSettings, renderAdminCard, renderAntiProtectionCard, renderAntiProtectionCardV2 };
