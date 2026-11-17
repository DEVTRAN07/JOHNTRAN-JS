// Shared JOHNTRAN Canvas design system for all non-menu cards.
// /theme is isolated to /menu and its folder cards.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas, registerFont } = require("canvas");
const BASE_CANVAS_THEME = "editorial";
const PALETTE = {};
const THEME_STYLE = {};

const BASE_PALETTE = {
  // Premium graphite / midnight blue; accents are reserved for important data.
  bg0: "#08111f", bg1: "#0d1b2d", bg2: "#142941",
  ink: "#f5f8ff", ink2: "#c4d1e2", mute: "#8ea2bb",
  accent: "#61d8f2", accent2: "#a5edfa",
  green: "#54d6a0", red: "#ff7188", gold: "#f3c46b"
};

const BASE_STYLE = {
  panelBg: "rgba(14, 28, 45, 0.97)",
  panelBorderAlpha: 0.24,
  panelLineWidth: 1,
  panelRadius: 17,
  btnRadius: 11,
  frame: false,
  glowCorners: ["rgba(46, 119, 190, .10)", "rgba(48, 183, 204, .045)"],
  shade: "rgba(3, 9, 18, .72)",
  foil: true
};

const PRESETS = {
  classic: { style: { frame: false, panelRadius: 16, btnRadius: 12, foil: false } },
  editorial: { style: {} }
};

function mixHex(hex, target, amount) {
  const source = String(hex || "#d4af37").replace("#", "");
  const destination = String(target || "#ffffff").replace("#", "");
  const a = [0, 2, 4].map(index => parseInt(source.slice(index, index + 2), 16));
  const b = [0, 2, 4].map(index => parseInt(destination.slice(index, index + 2), 16));
  return "#" + a.map((value, index) =>
    Math.round(value * (1 - amount) + b[index] * amount).toString(16).padStart(2, "0")
  ).join("");
}

function resolveTheme() {
  const name = String(global.config?.canvas?.theme || BASE_CANVAS_THEME).trim().toLowerCase();
  const preset = PRESETS[name] || PRESETS.editorial;

  // /theme owns only the /menu and folder-card palette. Other Canvas cards
  // keep this stable application palette and never inherit menu color changes.
  Object.assign(PALETTE, BASE_PALETTE);
  Object.assign(THEME_STYLE, BASE_STYLE, preset.style || {});
  THEME_STYLE.panelBorder = PALETTE.accent;
}

let _resolvedSignature = "";
function themeSignature() {
  return String(global.config?.canvas?.theme || BASE_CANVAS_THEME);
}

function ensureTheme() {
  const signature = themeSignature();
  if (signature !== _resolvedSignature) {
    _resolvedSignature = signature;
    resolveTheme();
  }
}

resolveTheme();
_resolvedSignature = themeSignature();

const GLYPH_FALLBACK = {
  "ᴶᴼᴴᴺ ᵀᴿᴬᴺ": "JOHN TRAN",
  "ᴶᴼᴴᴺ": "JOHN", "ᵀᴿᴬᴺ": "TRAN",
  "⌨️": "»", "⌨": "»", "🔗": "»", "📄": "»", "📡": "#", "📺": "▶",
  "❌": "×", "🚫": "×", "✖": "×", "❎": "×",
  "🎵": "♪", "🎧": "♫", "🎼": "♪",
  "❤️": "♥", "❤": "♥", "😽": "♥", "💔": "×",
  "👤": "o", "👥": "oo", "🙂": "o",
  "🔥": "*", "⭐": "★", "🌟": "★", "🏆": "★", "👑": "♛",
  "🔎": "?", "🔍": "?", "❓": "?", "❔": "?",
  "💡": "i", "ℹ️": "i", "⏳": "...", "⏰": "◷", "⏱": "◷",
  "🎯": ">", "👉": ">", "▶️": "▶", "◀️": "◀",
  "📌": "•", "📍": "•", "💰": "$", "💵": "$",
  "🎲": "?", "🃏": "?", "💬": "◌", "🗨️": "◌",
  "🖼️": "▣", "🖼": "▣", "🌐": "@", "📎": "♦",
  "🤖": "✦", "🧠": "✦", "✅": "✓", "✔️": "✓", "⚡": "!"
};

function sanitizeGlyphs(value) {
  let output = String(value ?? "");
  for (const [emoji, replacement] of Object.entries(GLYPH_FALLBACK)) {
    if (output.includes(emoji)) output = output.split(emoji).join(replacement);
  }
  return output
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2600}-\u{26CF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/[\u{1D00}-\u{1D7F}\u{2070}-\u{209F}]/gu, "");
}

const RANDOM_ACCENTS = [
  ["#d4af37", "#fbbf24", "#c4594e"],
  ["#d4af37", "#8fbf9f", "#5b8dd9"],
  ["#c9cdd3", "#d4af37", "#b74134"],
  ["#d4af37", "#9d7bd8", "#5fa8d3"],
  ["#e0b84c", "#7fb069", "#c97b8a"],
  ["#d4af37", "#e07a5f", "#81b29a"]
];

function randomAccent() {
  ensureTheme();
  return { prev: PALETTE.accent, out: PALETTE.ink2, next: PALETTE.accent2 };
}

function foil(ctx, x, y, width) {
  ensureTheme();
  if (!THEME_STYLE.foil) return;
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, PALETTE.accent);
  gradient.addColorStop(0.55, "rgba(85, 214, 232, .32)");
  gradient.addColorStop(1, "rgba(85, 214, 232, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, Math.max(1, S(2)));
}

function label(ctx, value, x, y, options = {}) {
  ensureTheme();
  const size = options.size || 15;
  const color = options.color || PALETTE.accent;
  const align = options.align || "left";
  ctx.font = font(size, "JT-Bold");
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(sanitizeGlyphs(String(value || "").toUpperCase().split("").join("\u200a")), x, y);
  ctx.textAlign = "left";
}

const WIDTH = Number(global.config?.canvas?.width) || 1280;
const DESIGN_WIDTH = 750;
const S = px => Math.round((px * WIDTH) / DESIGN_WIDTH);
const font = (px, family = "JT") => String(S(px)) + "px " + family;
const FONT_FAMILIES = ["JT", "JT-Bold", "JT-Display", "JT-Display-Bold", "JT-Round", "JT-Round-Bold", "JT-Mono", "JT-Mono-Bold"];

let fontsReady = false;
function initFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const register = (fontPath, family) => {
    try { if (fs.existsSync(fontPath)) registerFont(fontPath, { family }); } catch { /* optional font */ }
  };
  const platform = process.platform;
  if (platform === "darwin") {
    register("/System/Library/Fonts/Supplemental/Arial.ttf", "JT");
    register("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "JT-Bold");
    register("/System/Library/Fonts/Supplemental/Georgia.ttf", "JT-Display");
    register("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "JT-Display-Bold");
    register("/System/Library/Fonts/Avenir.ttc", "JT-Round");
    register("/System/Library/Fonts/Avenir Next.ttc", "JT-Round-Bold");
    register("/System/Library/Fonts/Menlo.ttc", "JT-Mono");
    register("/System/Library/Fonts/Courier New Bold.ttf", "JT-Mono-Bold");
  } else if (platform === "win32") {
    register("C:\\Windows\\Fonts\\arial.ttf", "JT");
    register("C:\\Windows\\Fonts\\arialbd.ttf", "JT-Bold");
    register("C:\\Windows\\Fonts\\georgia.ttf", "JT-Display");
    register("C:\\Windows\\Fonts\\georgiab.ttf", "JT-Display-Bold");
    register("C:\\Windows\\Fonts\\segoeui.ttf", "JT-Round");
    register("C:\\Windows\\Fonts\\segoeuib.ttf", "JT-Round-Bold");
    register("C:\\Windows\\Fonts\\consola.ttf", "JT-Mono");
    register("C:\\Windows\\Fonts\\consolab.ttf", "JT-Mono-Bold");
  } else {
    register("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "JT");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "JT-Bold");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "JT-Display");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "JT-Display-Bold");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "JT-Round");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "JT-Round-Bold");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "JT-Mono");
    register("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "JT-Mono-Bold");
  }
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, value, maxWidth) {
  let output = String(value ?? "");
  if (!maxWidth || ctx.measureText(output).width <= maxWidth) return output;
  while (output.length > 1 && ctx.measureText(output + "…").width > maxWidth) {
    output = output.slice(0, -1);
  }
  return output + "…";
}

async function paintBackground(ctx, width, height) {
  initFonts();
  ensureTheme();

  // One stable ocean surface for every non-menu Canvas. The /theme command
  // remains isolated to the menu and folder cards.
  const colors = [PALETTE.bg0, PALETTE.bg1, PALETTE.bg2, "#071a29"];
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.42, colors[1]);
  gradient.addColorStop(0.7, colors[2]);
  gradient.addColorStop(1, colors[3]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = (cx, cy, radius, color) => {
    const effect = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    effect.addColorStop(0, color);
    effect.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = effect;
    ctx.fillRect(0, 0, width, height);
  };
  const corners = THEME_STYLE.glowCorners || [];
  glow(width * 0.16, height * 0.05, width * 0.5, corners[0] || "rgba(212,175,55,.10)");
  glow(width * 0.88, height * 0.16, width * 0.42, corners[1] || "rgba(212,175,55,.04)");
  glow(width * 0.28, height * 0.98, width * 0.52, corners[1] || "rgba(212,175,55,.04)");
  glow(width * 0.92, height * 0.9, width * 0.5, corners[0] || "rgba(212,175,55,.10)");

  if (THEME_STYLE.frame) {
    ctx.save();
    ctx.strokeStyle = PALETTE.accent;
    ctx.globalAlpha = 0.20;
    ctx.lineWidth = Math.max(1, S(1));
    ctx.strokeRect(S(10), S(10), width - S(20), height - S(20));
    ctx.restore();
  }
}

function panel(ctx, x, y, width, height, radius = THEME_STYLE.panelRadius, accent = PALETTE.accent) {
  ensureTheme();
  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.shadowColor = "rgba(0,0,0,.24)";
  ctx.shadowBlur = S(10);
  ctx.shadowOffsetY = S(4);
  const gradient = ctx.createLinearGradient(x, y, x, y + height);
  gradient.addColorStop(0, "rgba(255,255,255,.055)");
  gradient.addColorStop(1, THEME_STYLE.panelBg);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = "rgba(164,190,218,.20)";
  ctx.lineWidth = Math.max(1, S(.8));
  ctx.stroke();

  // A short accent rail replaces the old bright outline around every tile.
  ctx.save();
  roundRect(ctx, x + S(12), y + S(1), Math.max(S(30), Math.min(width * .22, S(112))), S(2), S(1));
  ctx.fillStyle = accent || PALETTE.accent;
  ctx.globalAlpha = .48;
  ctx.fill();
  ctx.restore();
}

function button(ctx, x, y, width, height, value, color) {
  ensureTheme();
  ctx.fillStyle = color + "22";
  roundRect(ctx, x, y, width, height, S(THEME_STYLE.btnRadius));
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = S(1.3);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.font = font(13, "JT-Bold");
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(sanitizeGlyphs(value), x + width / 2, y + height / 2 + S(4));
  ctx.textAlign = "left";
}

function text(ctx, value, x, y, options = {}) {
  ensureTheme();
  const size = options.size || 20;
  const family = options.family || "JT";
  const color = options.color || PALETTE.ink2;
  const align = options.align || "left";
  ctx.font = font(size, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  const safe = sanitizeGlyphs(value);
  ctx.fillText(options.maxWidth ? truncate(ctx, safe, options.maxWidth) : safe, x, y);
  ctx.textAlign = "left";
}

function rgba(hex, alpha) {
  const value = String(hex || "#55d6e8").replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

function getCardPalette() {
  ensureTheme();
  const accent = PALETTE.accent;
  return {
    background: [PALETTE.bg0, PALETTE.bg1, PALETTE.bg2, "#071a29"],
    panel: [mixHex(PALETTE.bg2, "#ffffff", 0.045), mixHex(PALETTE.bg1, PALETTE.bg0, 0.16)],
    card: [mixHex(PALETTE.bg1, "#ffffff", 0.035), mixHex(PALETTE.bg0, PALETTE.bg1, 0.22)],
    footer: [mixHex(PALETTE.bg1, PALETTE.bg0, 0.28), PALETTE.bg0],
    accent,
    border: rgba(accent, 0.62),
    cardBorder: rgba(accent, 0.44),
    glow: [rgba(accent, 0.2), rgba(accent, 0.1)],
    infoFill: rgba(accent, 0.11),
    infoBorder: rgba(accent, 0.62),
    text: PALETTE.ink,
    muted: PALETTE.ink2
  };
}

function newCanvas(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  try {
    ctx.antialias = "best";
    ctx.quality = "best";
    ctx.patternQuality = "best";
    ctx.filter = "best";
    ctx.textDrawingMode = "default";
  } catch { /* older node-canvas */ }
  return { canvas, ctx };
}

function save(canvas, prefix) {
  ensureTheme();
  const filePath = path.join(
    os.tmpdir(),
    "jt_" + String(prefix || "canvas") + "_" + Date.now() + "_" +
      Math.random().toString(36).slice(2, 6) + ".png"
  );

  // Every canvas renderer saves the designed bitmap as-is. The Zalo chat
  // attachment is the canvas itself, not a simulated macOS desktop window.
  fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
  return filePath;
}

module.exports = {
  PALETTE, WIDTH, S, font, FONT_FAMILIES, initFonts, roundRect, truncate,
  paintBackground, panel, button, text, newCanvas, save, foil, label,
  THEME_STYLE, randomAccent, RANDOM_ACCENTS, getCardPalette,
  reload: resolveTheme, ensureTheme, sanitizeGlyphs, mixHex
};
