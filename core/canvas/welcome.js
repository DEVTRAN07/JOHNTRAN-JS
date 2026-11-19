"use strict";
const avatarCache = require("./avatarCache");
const theme = require("./theme");
const themeBackgrounds = require("./themeBackgrounds");

// Direct Welcome renders bypass canvasWorker, which normally prepares the
// selected wallpaper before every Canvas render. Share one preparation across
// concurrent member cards so a join burst downloads/decodes the theme once.
let themePrepareFlight = null;
async function prepareWelcomeTheme() {
  if (themePrepareFlight) return themePrepareFlight;
  themePrepareFlight = themeBackgrounds.prepare();
  try {
    return await themePrepareFlight;
  } finally {
    themePrepareFlight = null;
  }
}
function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeNames(values) {
  const names = (Array.isArray(values) ? values : []).map(value =>
    cleanText(typeof value === "object" ? value?.name || value?.dName : value)
  ).filter(Boolean).slice(0, 8);
  return names.length ? names : ["Thành viên mới"];
}
function initials(name) {
  const words = cleanText(name, "M").split(/\s+/u).filter(Boolean);
  return ((Array.from(words[0] || "M")[0] || "M") +
    (words.length > 1 ? Array.from(words[words.length - 1])[0] : "")).toLocaleUpperCase("vi-VN");
}
function normalizeMember(spec = {}) {
  const source = spec.member && typeof spec.member === "object" ? spec.member : {};
  const name = cleanText(source.name || source.dName || source.displayName ||
    spec.memberName || normalizeNames(spec.memberNames)[0], "Thành viên mới");
  const raw = source.avatarUrl || source.avatar || source.avatar_25 ||
    source.photoUrl || spec.memberAvatarUrl || spec.avatarUrl || "";
  return { name, avatarUrl: /^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : "" };
}
function drawText(ctx, value, x, y, size, color, bold, align, maxWidth) {
  ctx.save(); ctx.shadowColor = "rgba(0,5,16,.82)"; ctx.shadowBlur = theme.S(bold ? 2.8 : 2);
  ctx.shadowOffsetY = theme.S(.8); ctx.textBaseline = "alphabetic";
  theme.drawMulticolorText(ctx, String(value ?? ""), x, y, {
    size, family: bold ? "JT-Round-Bold" : "JT-Round", color,
    align: align || "left", maxWidth, multicolor: true
  });
  ctx.restore();
}
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius); ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius); ctx.arcTo(x, y, x + w, y, radius); ctx.closePath();
}
function drawPeopleIcon(ctx, cx, cy, size, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.3, theme.S(1.8)); ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(cx, cy - size * .2, size * .19, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - size * .36, cy + size * .42);
  ctx.bezierCurveTo(cx - size * .35, cy + size * .05, cx + size * .35, cy + size * .05, cx + size * .36, cy + size * .42);
  ctx.stroke(); ctx.restore();
}
function drawMemberAvatar(ctx, member, x, y, size, palette) {
  const cx = x + size / 2, cy = y + size / 2, image = avatarCache.getAvatar(member.avatarUrl);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size / 2 + theme.S(5), 0, Math.PI * 2);
  ctx.shadowColor = "rgba(0,0,0,.48)"; ctx.shadowBlur = theme.S(13); ctx.shadowOffsetY = theme.S(4);
  ctx.fillStyle = "rgba(5,14,28,.50)"; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.clip();
  if (image) {
    const scale = Math.max(size / image.width, size / image.height), w = image.width * scale, h = image.height * scale;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
  } else {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, "#123c5c"); gradient.addColorStop(.55, "#155575"); gradient.addColorStop(1, "#36275e");
    ctx.fillStyle = gradient; ctx.fillRect(x, y, size, size);
    const glow = ctx.createRadialGradient(x + size * .28, y + size * .22, 0, x + size * .28, y + size * .22, size * .78);
    glow.addColorStop(0, "rgba(116,232,255,.40)"); glow.addColorStop(1, "rgba(116,232,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(x, y, size, size);
    theme.drawMulticolorText(ctx, initials(member.name), cx, cy + theme.S(11), {
      size: 34, family: "JT-Round-Bold", color: "#f5fbff", align: "center", maxWidth: size * .68, multicolor: true
    });
  }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, size / 2 + theme.S(2), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.94)"; ctx.lineWidth = theme.S(2.2);
  ctx.shadowColor = palette.accent; ctx.shadowBlur = theme.S(12); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, size / 2 + theme.S(7), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(230,249,255,.48)"; ctx.lineWidth = Math.max(1, theme.S(.9)); ctx.shadowBlur = 0; ctx.stroke();
  ctx.restore();
}
function drawWelcomeBanner(ctx, width, height, spec, member, palette) {
  const S = theme.S, margin = S(13);
  // One full-bleed theme photo + one transparent foreground, based on the
  // supplied one-person reference. No nested opaque cards.
  theme.paintBackground(ctx, width, height, {
    veilAlpha: [.17, .23, .31], vignetteAlpha: .17, auroraStrength: .13, sharpen: .34
  });
  ctx.save(); roundRectPath(ctx, margin, margin, width - margin * 2, height - margin * 2, S(20));
  ctx.strokeStyle = "rgba(245,252,255,.82)"; ctx.lineWidth = Math.max(1, S(.9));
  ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = S(5); ctx.stroke();
  roundRectPath(ctx, margin + S(2), margin + S(2), width - margin * 2 - S(4), height - margin * 2 - S(4), S(18));
  ctx.strokeStyle = "rgba(105,221,255,.18)"; ctx.lineWidth = Math.max(1, S(.7)); ctx.shadowBlur = 0; ctx.stroke(); ctx.restore();

  const avatarSize = S(116), avatarX = S(47), avatarY = Math.round((height - avatarSize) / 2);
  drawMemberAvatar(ctx, member, avatarX, avatarY, avatarSize, palette);
  const textLeft = avatarX + avatarSize + S(34), textRight = width - S(34);
  const center = (textLeft + textRight) / 2, maxWidth = textRight - textLeft;
  drawText(ctx, cleanText(spec.groupName, "Cộng đồng JOHNTRAN"), center, S(61), 18, palette.text, true, "center", maxWidth);
  const isGoodbye = spec.mode === "goodbye";
  drawText(ctx, (isGoodbye ? "Tạm biệt " : "Chào mừng ") + member.name,
    center, S(105), 29, palette.text, true, "center", maxWidth);
  drawText(ctx, isGoodbye ? "Đã rời nhóm" : "Đã tham gia nhóm",
    center, S(143), 17, palette.text, true, "center", maxWidth);
  drawText(ctx, cleanText(spec.footerText, isGoodbye
    ? "Chúc bạn mọi điều tốt đẹp trên chặng đường tiếp theo!"
    : "Chúc bạn có những phút giây vui vẻ cùng mọi người!"),
    center, S(181), 12.5, palette.muted, true, "center", maxWidth);
  drawText(ctx, cleanText(spec.botName || global.config?.name_bot || "JOHNTRAN"),
    textRight, height - S(12), 8.5, palette.accent, true, "right", S(150));
}
function drawStatusCard(ctx, width, height, spec, palette) {
  const S = theme.S, margin = S(32), prefix = cleanText(spec.prefix || global.config?.prefix || "/");
  const groupName = cleanText(spec.groupName, "cộng đồng của chúng ta");
  const botName = cleanText(spec.botName || global.config?.name_bot || "JOHNTRAN");
  theme.paintBackground(ctx, width, height, {
    veilAlpha: [.025, .04, .055], vignetteAlpha: .055, auroraStrength: .22, sharpen: .42
  });
  const brandX = margin + S(38);
  drawPeopleIcon(ctx, margin + S(15), S(39), S(25), palette.accent);
  drawText(ctx, "JOHNTRAN-JS", brandX, S(36), 22, palette.text, true);
  drawText(ctx, "WELCOME SETTINGS", brandX, S(55), 10.5, palette.muted, true);
  drawText(ctx, "GROUP SETTINGS", width - margin, S(47), 10, palette.accent, true, "right");
  ctx.save(); ctx.beginPath(); ctx.moveTo(margin, S(79)); ctx.lineTo(width - margin, S(79));
  ctx.strokeStyle = "rgba(98,220,255,.35)"; ctx.lineWidth = Math.max(1, S(.8)); ctx.stroke(); ctx.restore();
  drawText(ctx, "CHÀO MỪNG THÀNH VIÊN", margin, S(132), 27, palette.text, true, "left", width - margin * 2);
  drawText(ctx, groupName, margin, S(161), 15, palette.muted, false, "left", width - margin * 2);
  const enabled = Boolean(spec.enabled);
  const goodbyeEnabled = Boolean(spec.goodbyeEnabled);
  const synchronized = enabled === goodbyeEnabled;
  const statusColor = synchronized
    ? (enabled ? palette.green : palette.red)
    : palette.accent;
  const statusLabel = synchronized
    ? (enabled ? "JOIN + OUT  ·  ĐANG BẬT" : "JOIN + OUT  ·  ĐANG TẮT")
    : "CHƯA ĐỒNG BỘ  ·  JOIN " + (enabled ? "BẬT" : "TẮT") +
      " / OUT " + (goodbyeEnabled ? "BẬT" : "TẮT");
  ctx.save(); ctx.beginPath(); ctx.arc(margin + S(10), S(222), S(6), 0, Math.PI * 2);
  ctx.fillStyle = statusColor; ctx.fill(); ctx.restore();
  drawText(ctx, statusLabel,
    margin + S(28), S(227), 14, statusColor, true, "left", width - margin * 2 - S(30));
  drawText(ctx, "Một lệnh duy nhất điều khiển cả JOIN và OUT",
    margin, S(270), 12.5, palette.muted, true, "left", width - margin * 2);

  drawText(ctx, prefix + "welcome on    ·  Bật JOIN + OUT", margin, S(320), 13.5, palette.text, true);
  drawText(ctx, prefix + "welcome off   ·  Tắt JOIN + OUT", margin, S(352), 13.5, palette.text, true);
  drawText(ctx, prefix + "welcome test  ·  Xem 2 card + tag bên dưới", margin, S(384), 13.5, palette.text, true);
  drawText(ctx, botName, width - margin, height - S(20), 9, palette.accent, true, "right");
}
async function renderWelcomeCard(spec = {}) {
  await prepareWelcomeTheme();
  theme.initFonts(); theme.ensureTheme();
  const S = theme.S, width = theme.WIDTH, palette = theme.getCardPalette();
  const mode = ["status", "goodbye"].includes(spec.mode) ? spec.mode : "welcome";
  const height = mode === "status" ? S(560) : S(220);
  const { canvas, ctx } = theme.newCanvas(width, height);
  if (mode === "status") {
    drawStatusCard(ctx, width, height, spec, palette);
    return theme.save(canvas, "welcome");
  }
  const member = normalizeMember(spec);
  if (member.avatarUrl) await avatarCache.warmAvatar(member.avatarUrl, { timeout: 1800 });
  drawWelcomeBanner(ctx, width, height, spec, member, palette);
  return theme.save(canvas, "welcome");
}
module.exports = { renderWelcomeCard, _test: { normalizeNames, initials, normalizeMember } };
