"use strict";


const { loadImage } = require("canvas");
const avatarCache = require("./avatarCache");
const theme = require("./theme");
const menuPalette = require("./menuPalette");
const { drawCategoryIcon } = require("./menuIcons");

function rounded(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawText(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save();
  ctx.font = theme.font(size, bold ? "JT-Round-Bold" : "JT-Round");
  ctx.fillStyle = color;
  ctx.textAlign = align || "left";
  ctx.textBaseline = "alphabetic";
  let text = String(value == null ? "" : value);
  if (maxWidth && ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(text + "…").width > maxWidth) {
      text = text.slice(0, -1);
    }
    text += "…";
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function paintBackdrop(ctx, w, h, palette) {
  const colors = palette.background;
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, colors[0]);
  base.addColorStop(0.42, colors[1]);
  base.addColorStop(0.7, colors[2]);
  base.addColorStop(1, colors[3]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.16, h * 0.05, w * 0.5, palette.glow[0]);
  glow(w * 0.88, h * 0.16, w * 0.42, palette.glow[1]);
  glow(w * 0.28, h * 0.98, w * 0.52, palette.glow[1]);
  glow(w * 0.92, h * 0.9, w * 0.5, palette.glow[0]);
}

function drawOuterPanel(ctx, x, y, w, h, radius, colors, borderColor) {
  ctx.save();
  rounded(ctx, x, y, w, h, radius);
  ctx.shadowColor = "rgba(0,0,0,.38)";
  ctx.shadowBlur = theme.S(24);
  ctx.shadowOffsetY = theme.S(10);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, colors[0]);
  fill.addColorStop(1, colors[1]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  rounded(ctx, x, y, w, h, radius);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = Math.max(1, theme.S(1));
  ctx.stroke();
  rounded(ctx, x + theme.S(1), y + theme.S(1), w - theme.S(2), h - theme.S(2), Math.max(0, radius - theme.S(1)));
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = Math.max(1, theme.S(1));
  ctx.stroke();
}

function presenceBadgePosition(x, y, size, radius) {
  const outerRadius = radius + theme.S(1.2);
  const inward = Math.max(0, size / 2 - outerRadius * 0.55);
  const diagonal = inward * Math.SQRT1_2;
  const offset = size / 2 + diagonal;
  return { cx: x + offset, cy: y + offset };
}

function drawAvatar(ctx, url, name, x, y, size, withStatus) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Never wait for a remote avatar while drawing a command card. A cache miss
  // paints the initials now and starts a background download for the next card.
  const image = avatarCache.getAvatar(url);
  if (image) {
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  } else {
    drawAvatarFallback(ctx, name, x, y, size);
  }

  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - theme.S(0.7), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = theme.S(1.2);
  ctx.stroke();

  if (withStatus) {
    const radius = theme.S(6.5);
    const { cx, cy } = presenceBadgePosition(x, y, size, radius);

    // Put the presence badge on the same 45-degree anchor of every avatar
    // and draw its shadow separately so it cannot shift the green center.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.42)";
    ctx.shadowBlur = theme.S(2.2);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = theme.S(1);
    ctx.beginPath();
    ctx.arc(cx, cy, radius + theme.S(1.2), 0, Math.PI * 2);
    ctx.fillStyle = "#f5ffff";
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#08c977";
    ctx.fill();
  }
}

function drawAvatarFallback(ctx, name, x, y, size) {
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, "#d8c8b8");
  gradient.addColorStop(1, "#718c9b");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.font = theme.font(17, "JT-Round-Bold");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(Array.from(String(name || "U"))[0].toUpperCase(), x + size / 2, y + size / 2);
}

function drawClock(ctx, x, y, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = theme.S(1.6);
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - size * 0.24);
  ctx.moveTo(x, y); ctx.lineTo(x + size * 0.19, y + size * 0.08); ctx.stroke();
  ctx.restore();
}

function drawChevron(ctx,cx,cy,size,color) {
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=Math.max(1.4,theme.S(1.8));
  ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath();
  ctx.moveTo(cx-size,cy-size); ctx.lineTo(cx+size,cy); ctx.lineTo(cx-size,cy+size); ctx.stroke(); ctx.restore();
}

function drawInfoMark(ctx,cx,cy,size,color) {
  ctx.save(); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=Math.max(1.2,theme.S(1.5));
  ctx.beginPath(); ctx.arc(cx,cy,size,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy-size*0.38,theme.S(1),0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx,cy-size*0.05); ctx.lineTo(cx,cy+size*0.45); ctx.stroke(); ctx.restore();
}

function drawPaletteIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = theme.S(1.7);
  ctx.beginPath(); ctx.ellipse(cx, cy, size * 0.45, size * 0.36, -0.18, 0, Math.PI * 2); ctx.stroke();
  const dots = [[-0.2, -0.08], [0.02, -0.19], [0.23, -0.05], [-0.08, 0.16]];
  ctx.fillStyle = color;
  for (const dot of dots) {
    ctx.beginPath(); ctx.arc(cx + dot[0] * size, cy + dot[1] * size, theme.S(1.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBotIcon(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = theme.S(1.6);
  rounded(ctx, cx - size * 0.34, cy - size * 0.2, size * 0.68, size * 0.48, theme.S(4)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - size * 0.2); ctx.lineTo(cx, cy - size * 0.42); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - size * 0.47, theme.S(1.7), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.beginPath(); ctx.arc(cx - size * 0.13, cy, theme.S(1.4), 0, Math.PI * 2);
  ctx.arc(cx + size * 0.13, cy, theme.S(1.4), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function getMainMenuPalette() {
  const active = menuPalette.getPalette();
  // Keep a deliberately chosen /theme preset, but use the blue JOHNTRAN
  // identity when the menu has never been themed by an administrator.
  let hasSavedTheme = false;
  try { hasSavedTheme = fs.existsSync(menuPalette.THEME_FILE); } catch { /* keep default */ }
  if (hasSavedTheme) return active;

  const accent = "#62dcff";
  return {
    ...active,
    label: "JOHNTRAN · Blue Neon",
    accent,
    background: ["#030914", "#07182d", "#102b4b", "#040d1d"],
    panel: ["#102b4b", "#08182c"],
    card: ["#122c4b", "#091a31"],
    footer: ["#0c2038", "#071426"],
    border: "rgba(98,220,255,.46)",
    cardBorder: "rgba(98,220,255,.28)",
    glow: ["rgba(33,151,255,.20)", "rgba(118,94,255,.13)"],
    infoFill: "rgba(98,220,255,.10)",
    infoBorder: "rgba(98,220,255,.40)",
    text: "#f4f9ff",
    muted: "#a9bfd8"
  };
}

function paintMainMenuBackdrop(ctx, w, h, palette) {
  paintBackdrop(ctx, w, h, palette);

  // A restrained star field adds depth without competing with the menu.
  ctx.save();
  for (let i = 0; i < 64; i++) {
    const x = (i * 173 + 47) % w;
    const y = (i * 97 + 31) % h;
    const radius = i % 9 === 0 ? theme.S(1.15) : theme.S(0.55);
    const alpha = i % 4 === 0 ? 0.30 : 0.15;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(190,225,255," + alpha + ")";
    ctx.fill();
  }
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.18, w * 0.5, h * 0.45, w * 0.78);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,4,14,.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawMainMenuShell(ctx, x, y, w, h, radius, palette) {
  ctx.save();
  rounded(ctx, x, y, w, h, radius);
  ctx.shadowColor = "rgba(0,0,0,.52)";
  ctx.shadowBlur = theme.S(28);
  ctx.shadowOffsetY = theme.S(12);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, palette.panel[0]);
  fill.addColorStop(0.48, "#0b2039");
  fill.addColorStop(1, palette.panel[1]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  rounded(ctx, x, y, w, h, radius);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(1, theme.S(1.25));
  ctx.stroke();

  rounded(ctx, x + theme.S(3), y + theme.S(3), w - theme.S(6), h - theme.S(6), Math.max(0, radius - theme.S(3)));
  ctx.strokeStyle = "rgba(220,244,255,.10)";
  ctx.lineWidth = Math.max(1, theme.S(0.8));
  ctx.stroke();

  const topGlow = ctx.createLinearGradient(x + theme.S(25), y, x + w - theme.S(25), y);
  topGlow.addColorStop(0, "rgba(98,220,255,0)");
  topGlow.addColorStop(0.48, "rgba(98,220,255,.42)");
  topGlow.addColorStop(1, "rgba(98,220,255,0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(x + theme.S(24), y + theme.S(1), w - theme.S(48), Math.max(1, theme.S(1.2)));
}

function drawMenuPill(ctx, x, y, w, h, text, palette) {
  ctx.save();
  rounded(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(98,220,255,.09)";
  ctx.fill();
  rounded(ctx, x, y, w, h, h / 2);
  ctx.strokeStyle = "rgba(98,220,255,.25)";
  ctx.lineWidth = Math.max(1, theme.S(0.75));
  ctx.stroke();
  drawText(ctx, text, x + w / 2, y + h * 0.68, 9.5, palette.accent, true, "center", w - theme.S(8));
  ctx.restore();
}

const MAIN_MENU_SUBTITLES = Object.freeze({
  info: "Tài khoản & hướng dẫn",
  public: "Tiện ích dùng chung",
  music: "Nghe nhạc trực tuyến",
  game: "Trò chơi giải trí",
  tools: "Tự động hóa tác vụ",
  test: "Lệnh thử nghiệm",
  anti: "Bảo vệ nhóm",
  manager: "Quản lý thành viên",
  admin: "Quản trị bot",
  mybot: "Theo dõi bot",
  hidden: "Lệnh đặc biệt"
});

function drawMainMenuTile(ctx, item, x, y, w, h, palette) {
  ctx.save();
  rounded(ctx, x, y, w, h, theme.S(12));
  ctx.shadowColor = "rgba(0,0,0,.30)";
  ctx.shadowBlur = theme.S(10);
  ctx.shadowOffsetY = theme.S(4);
  const fill = ctx.createLinearGradient(x, y, x + w, y + h);
  fill.addColorStop(0, "#163657");
  fill.addColorStop(0.5, palette.card[0]);
  fill.addColorStop(1, palette.card[1]);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  rounded(ctx, x, y, w, h, theme.S(12));
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = Math.max(1, theme.S(0.9));
  ctx.stroke();

  rounded(ctx, x + theme.S(1.5), y + theme.S(1.5), w - theme.S(3), h - theme.S(3), theme.S(10.5));
  ctx.strokeStyle = "rgba(230,246,255,.075)";
  ctx.lineWidth = Math.max(1, theme.S(0.7));
  ctx.stroke();

  const edge = ctx.createLinearGradient(x, y, x, y + h);
  edge.addColorStop(0, "rgba(98,220,255,.85)");
  edge.addColorStop(1, "rgba(98,220,255,.12)");
  ctx.fillStyle = edge;
  rounded(ctx, x + theme.S(1), y + theme.S(15), theme.S(2), h - theme.S(30), theme.S(1));
  ctx.fill();

  const iconCenterX = x + theme.S(40);
  const centerY = y + h / 2;
  drawCategoryIcon(ctx, resolveFolderIconSlug(item.slug, item.name), iconCenterX, centerY, theme.S(40));

  const textX = x + theme.S(72);
  const usage = String(item.usage || "").trim().toUpperCase();
  const pillW = theme.S(54);
  if (usage) drawMenuPill(ctx, x + w - pillW - theme.S(10), y + theme.S(10), pillW, theme.S(19), usage, palette);

  drawText(ctx, String(item.name || "Danh mục").toUpperCase(), textX, centerY - theme.S(2), 19, palette.text, true, "left", w - theme.S(100));
  const subtitleKey = resolveFolderIconSlug(item.slug, item.name);
  const subtitle = MAIN_MENU_SUBTITLES[subtitleKey] || item.category || "Chức năng khả dụng";
  drawText(ctx, subtitle, textX, centerY + theme.S(16), 11.5, palette.muted, false, "left", w - theme.S(91));

  drawChevron(ctx, x + w - theme.S(16), centerY + theme.S(1), theme.S(4), palette.accent);
}

async function renderMenuGrid({ requesterName, requesterAvatarUrl, botVersion, prefix, totalCommands, commands }) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 900 / 1280);
  const result = theme.newCanvas(W, H);
  const ctx = result.ctx;
  const palette = getMainMenuPalette();

  paintMainMenuBackdrop(ctx, W, H, palette);

  // Layer 2: one inset glass shell sits above the cinematic background.
  const panelX = S(18);
  const panelY = S(17);
  const panelW = W - panelX * 2;
  const panelH = H - panelY * 2;
  drawMainMenuShell(ctx, panelX, panelY, panelW, panelH, S(20), palette);

  const margin = S(32);
  const brandX = margin + S(38);
  drawBotIcon(ctx, margin + S(15), S(39), S(23), palette.accent);
  drawText(ctx, "JOHNTRAN-JS", brandX, S(36), 22, palette.text, true);
  drawText(ctx, "DANH SÁCH TÍNH NĂNG", brandX, S(54), 10.5, palette.muted, true);

  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date());

  ctx.save();
  ctx.font = theme.font(11, "JT-Round-Bold");
  const timeWidth = ctx.measureText(time).width;
  ctx.restore();

  const timeRight = W - margin;
  const timeLeft = timeRight - timeWidth;
  const clockSize = S(10);
  const clockGap = S(11);
  drawClock(ctx, timeLeft - clockGap - clockSize / 2, S(61), clockSize, palette.accent);
  drawText(ctx, time, timeRight, S(65), 11, palette.accent, true, "right");

  const groups = Array.isArray(commands) ? commands.slice() : [];
  const menuOrder = {
    info: 0, public: 1, music: 2, game: 3, tools: 4,
    test: 5, anti: 6, manager: 7, admin: 8, bot: 9, mybot: 9, hidden: 10
  };
  groups.sort((a, b) => {
    const aKey = resolveFolderIconSlug(a.slug, a.name);
    const bKey = resolveFolderIconSlug(b.slug, b.name);
    return (menuOrder[aKey] ?? 99) - (menuOrder[bKey] ?? 99);
  });

  const explicitCommandCount = totalCommands !== undefined &&
    totalCommands !== null && Number.isFinite(Number(totalCommands));
  const usageCounts = groups.map(item => {
    const count = parseInt(String(item.usage || "").trim(), 10);
    return Number.isFinite(count) && count >= 0 ? count : null;
  }).filter(count => count !== null);
  const hasCommandCount = explicitCommandCount || usageCounts.length > 0;
  const visibleCommandCount = explicitCommandCount
    ? Math.max(0, Number(totalCommands))
    : usageCounts.reduce((sum, count) => sum + count, 0);

  drawText(ctx, groups.length + " DANH MỤC", margin, S(82), 9.5, palette.accent, true);
  drawText(
    ctx,
    hasCommandCount ? visibleCommandCount + " LỆNH KHẢ DỤNG" : "CHỌN DANH MỤC ĐỂ XEM LỆNH",
    margin + S(96),
    S(82),
    9.5,
    palette.muted,
    true,
    "left",
    W - margin * 2 - S(110)
  );

  // Layer 3: each category is an individually raised module inside the shell.
  const columns = 3;
  const gap = S(10);
  const gridY = S(93);
  const cardW = (W - margin * 2 - gap * (columns - 1)) / columns;
  const cardH = S(74);

  groups.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = margin + col * (cardW + gap);
    const y = gridY + row * (cardH + gap);
    drawMainMenuTile(ctx, item, x, y, cardW, cardH, palette);
  });

  if (!groups.length) {
    drawText(ctx, "Chưa có danh mục khả dụng", W / 2, H / 2, 18, palette.muted, true, "center");
  }

  const footerX = margin;
  const footerH = S(52);
  const footerY = H - panelY - footerH - S(8);
  const footerW = W - margin * 2;

  ctx.save();
  rounded(ctx, footerX, footerY, footerW, footerH, S(15));
  ctx.shadowColor = "rgba(0,0,0,.34)";
  ctx.shadowBlur = S(10);
  ctx.shadowOffsetY = S(4);
  const footerFill = ctx.createLinearGradient(footerX, footerY, footerX, footerY + footerH);
  footerFill.addColorStop(0, palette.footer[0]);
  footerFill.addColorStop(1, palette.footer[1]);
  ctx.fillStyle = footerFill;
  ctx.fill();
  ctx.restore();
  rounded(ctx, footerX, footerY, footerW, footerH, S(15));
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = S(0.9);
  ctx.stroke();

  const avatarSize = S(35);
  const avatarX = footerX + S(11);
  const avatarY = footerY + (footerH - avatarSize) / 2;
  drawAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, true);
  drawText(ctx, requesterName || "Người dùng", avatarX + avatarSize + S(9), footerY + S(32), 13, palette.text, true, "left", S(125));

  drawText(ctx, hasCommandCount ? groups.length + " DANH MỤC  ·  " + visibleCommandCount + " LỆNH" : groups.length + " DANH MỤC", footerX + S(205), footerY + S(32), 10, palette.muted, true);

  const prefixLabel = "PREFIX " + String(prefix || "/");
  drawText(ctx, prefixLabel, W - margin - S(112), footerY + S(32), 10, palette.accent, true, "right", S(80));
  drawBotIcon(ctx, W - margin - S(73), footerY + footerH / 2, S(16), palette.accent);
  drawText(ctx, "v" + (botVersion || "1.0.2"), W - margin - S(8), footerY + S(32), 11, palette.accent, true, "right");

  return theme.save(result.canvas, "menu");
}

const FOLDER_ICON_ALIASES = Object.freeze({ utility: "public", group: "manager", bot: "mybot", special: "hidden" });

function resolveFolderIconSlug(folderSlug, folderName) {
  const key = String(folderSlug || folderName || "").trim().toLowerCase();
  return FOLDER_ICON_ALIASES[key] || key;
}

async function renderFolderCard({
  folderName, folderSlug, folderDescription, requesterName, requesterAvatarUrl, botVersion
}) {
  theme.initFonts();
  const S = theme.S;
  const W = theme.WIDTH;
  const H = Math.round(W * 540 / 1280);
  const result = theme.newCanvas(W, H);
  const ctx = result.ctx;
  const palette = menuPalette.getPalette();

  paintBackdrop(ctx, W, H, palette);

  const panelX = S(24);
  const panelY = S(24);
  const panelW = W - panelX * 2;
  const panelH = S(252);
  drawOuterPanel(ctx, panelX, panelY, panelW, panelH, S(15), palette.panel, palette.border);

  const padX = panelX + S(23);
  const iconCenterX = padX + S(25);
  const iconCenterY = panelY + S(52);
  const slug = resolveFolderIconSlug(folderSlug, folderName);
  drawCategoryIcon(ctx, slug, iconCenterX, iconCenterY, S(54));

  const titleX = padX + S(70);
  drawText(ctx, "Chi tiết chức năng: " + (folderName || "Danh mục"), titleX, panelY + S(61), 22, palette.text, true);
  drawText(ctx, folderDescription || "Các chức năng hỗ trợ", padX, panelY + S(120), 20, palette.text, true);

  const infoX = padX;
  const infoY = panelY + S(149);
  const infoW = S(502);
  const infoH = S(42);
  rounded(ctx, infoX, infoY, infoW, infoH, S(12));
  ctx.fillStyle = palette.infoFill;
  ctx.fill();
  rounded(ctx, infoX, infoY, infoW, infoH, S(12));
  ctx.strokeStyle = palette.infoBorder;
  ctx.lineWidth = S(1);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(infoX + S(23), infoY + infoH / 2, S(8), 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = S(1.5);
  ctx.stroke();
  drawInfoMark(ctx, infoX + S(23), infoY + infoH / 2, S(8), palette.accent);
  drawText(
    ctx,
    "Gõ tên lệnh hoặc tag bot để thực thi chức năng " + (folderName || ""),
    infoX + S(42),
    infoY + S(27),
    15.5,
    palette.text,
    true,
    "left",
    infoW - S(54)
  );

  const avatarSize = S(76);
  const avatarX = panelX + panelW - S(28) - avatarSize;
  const avatarY = panelY + S(81);
  await drawAvatar(ctx, requesterAvatarUrl, requesterName, avatarX, avatarY, avatarSize, true);

  const footerY = panelY + panelH - S(18);
  // Keep the icons separate from the version label.
  drawPaletteIcon(ctx, W - S(174), footerY, S(14), palette.accent);
  drawBotIcon(ctx, W - S(140), footerY, S(16), palette.accent);
  drawText(ctx, "v" + (botVersion || "1.0.2"), W - S(24), footerY + S(6), 16, palette.accent, true, "right");

  return theme.save(result.canvas, "menu_folder");
}

module.exports = { renderMenuGrid, renderFolderCard, _test: { presenceBadgePosition, resolveFolderIconSlug } };
