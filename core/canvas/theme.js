// Shared JOHNTRAN Canvas design system. Every Canvas follows the /menu theme.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCanvas, registerFont } = require("canvas");
const brandTheme = require("./brandTheme");
const themeBackgrounds = require("./themeBackgrounds");
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
  const active = brandTheme.getPalette();
  const accent = active.accent || "#62dcff";
  Object.assign(PALETTE, {
    bg0: active.background[0],
    bg1: active.background[1],
    bg2: active.background[2],
    ink: active.text || "#f4f9ff",
    ink2: active.muted || "#a9bfd8",
    mute: active.muted || "#a9bfd8",
    accent,
    accent2: mixHex(accent, "#ffffff", 0.30),
    green: "#54d6a0",
    red: "#ff7188",
    gold: "#f3c46b"
  });
  Object.assign(THEME_STYLE, BASE_STYLE, {
    panelBg: active.card[1],
    panelBorder: active.border,
    glowCorners: active.glow,
    panelRadius: 15,
    btnRadius: 12,
    foil: true
  });
}

let _resolvedSignature = "";
function themeSignature() {
  return brandTheme.signature();
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
  gradient.addColorStop(0.55, rgba(PALETTE.accent, .32));
  gradient.addColorStop(1, "rgba(85, 214, 232, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, Math.max(1, S(2)));
}

function label(ctx, value, x, y, options = {}) {
  ensureTheme();
  const size = options.size || 15;
  const color = options.randomColor === false
    ? (options.color || PALETTE.accent)
    : (options.color || randomTextColor(String(value) + ":" + x + ":" + y));
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

function sharpenPhotoImageData(imageData, strength = 0.38) {
  if (!imageData || !imageData.data || !Number.isInteger(imageData.width) ||
      !Number.isInteger(imageData.height)) {
    throw new TypeError("ImageData không hợp lệ để tăng độ nét");
  }
  const width = imageData.width;
  const height = imageData.height;
  const pixels = imageData.data;
  const amount = Math.max(0, Math.min(0.8, Number(strength) || 0));
  if (!amount || width < 3 || height < 3) return imageData;

  // A restrained 5-tap unsharp mask improves real edges without creating
  // bright halos around text, avatars or the neon frame.
  const source = new Uint8ClampedArray(pixels);
  const rowStride = width * 4;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const neighbors = (
          source[index - 4 + channel] +
          source[index + 4 + channel] +
          source[index - rowStride + channel] +
          source[index + rowStride + channel]
        ) * 0.25;
        const center = source[index + channel];
        pixels[index + channel] = center + (center - neighbors) * amount;
      }
    }
  }
  return imageData;
}

function sharpenPhoto(ctx, width, height, strength) {
  const amount = Math.max(0, Math.min(0.8, Number(strength) || 0));
  if (!amount) return false;
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    sharpenPhotoImageData(imageData, amount);
    ctx.putImageData(imageData, 0, 0);
    return true;
  } catch (error) {
    // Some Canvas backends disable pixel reads; leave the original photo intact.
    return false;
  }
}

function paintBackground(ctx, width, height, options = {}) {
  initFonts();
  ensureTheme();
  const palette = getCardPalette();
  const image = themeBackgrounds.getActiveImage();

  // Layer 0: full-bleed photo. Cover-crop preserves the source's sharpness
  // and avoids stretching portrait wallpapers across the Canvas.
  if (image) {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    // Ask node-canvas for its best resampling path before drawing portrait
    // source photos onto the wide menu/folder canvases.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    sharpenPhoto(ctx, width, height, options.sharpen || 0);
  } else {
    const fallback = ctx.createLinearGradient(0, 0, width, height);
    fallback.addColorStop(0, "#030914");
    fallback.addColorStop(0.46, "#102b4b");
    fallback.addColorStop(1, "#040d1d");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, width, height);
  }

  // Layer 1: transparent navy veil; it darkens photography without hiding it.
  const defaultVeilAlpha = [0.38, 0.53, 0.62];
  const requestedVeilAlpha = Array.isArray(options.veilAlpha)
    ? options.veilAlpha
    : defaultVeilAlpha;
  const veilAlpha = defaultVeilAlpha.map((fallback, index) => {
    const value = Number(requestedVeilAlpha[index]);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  });
  const veil = ctx.createLinearGradient(0, 0, width, height);
  veil.addColorStop(0, "rgba(2,8,20," + veilAlpha[0] + ")");
  veil.addColorStop(0.48, "rgba(3,12,29," + veilAlpha[1] + ")");
  veil.addColorStop(1, "rgba(2,7,18," + veilAlpha[2] + ")");
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, width, height);

  const glow = (cx, cy, radius, color, alpha = 1) => {
    const effect = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    effect.addColorStop(0, color);
    effect.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = effect;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  };

  // Layer 2: Keep Aurora as edge ambience so it does not wash out photo detail.
  const auroraStrength = Number.isFinite(Number(options.auroraStrength))
    ? Math.max(0, Math.min(1, Number(options.auroraStrength)))
    : 1;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  glow(width * 0.13, height * 0.08, width * 0.58, "rgba(22,214,255,.56)", 0.42 * auroraStrength);
  glow(width * 0.83, height * 0.17, width * 0.52, "rgba(126,94,255,.52)", 0.34 * auroraStrength);
  glow(width * 0.50, height * 0.98, width * 0.66, "rgba(28,255,207,.36)", 0.28 * auroraStrength);
  glow(width * 0.96, height * 0.78, width * 0.34, "rgba(49,157,255,.45)", 0.26 * auroraStrength);

  const ribbon = (y, bend, color, alpha, lineWidth) => {
    const gradient = ctx.createLinearGradient(0, y - height * 0.12, width, y + height * 0.16);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.22, color);
    gradient.addColorStop(0.58, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(-width * 0.08, y);
    ctx.bezierCurveTo(
      width * 0.24, y - bend,
      width * 0.58, y + bend,
      width * 1.08, y - height * 0.08
    );
    ctx.strokeStyle = gradient;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = S(lineWidth);
    ctx.lineCap = "round";
    ctx.shadowColor = color;
    ctx.shadowBlur = S(26);
    ctx.stroke();
  };
  ribbon(height * 0.19, height * 0.17, "rgba(36,219,255,.40)", 0.20 * auroraStrength, 38);
  ribbon(height * 0.34, height * 0.13, "rgba(129,112,255,.38)", 0.15 * auroraStrength, 30);
  ribbon(height * 0.73, height * 0.12, "rgba(35,255,210,.34)", 0.14 * auroraStrength, 34);
  ctx.restore();

  // Fine stars and edge vignette add depth but leave the photograph visible.
  ctx.save();
  for (let i = 0; i < 72; i++) {
    const x = (i * 173 + 47) % width;
    const y = (i * 97 + 31) % height;
    const radius = i % 11 === 0 ? S(1.25) : S(0.55);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.45, radius), 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0
      ? rgba("#a4f4ff", 0.42 * Math.max(0.18, auroraStrength))
      : rgba("#dfEfff", 0.20 * Math.max(0.18, auroraStrength));
    ctx.fill();
  }

  const vignette = ctx.createRadialGradient(
    width * 0.5, height * 0.45, height * 0.16,
    width * 0.5, height * 0.45, width * 0.82
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  const vignetteAlpha = Number.isFinite(Number(options.vignetteAlpha))
    ? Math.max(0, Math.min(1, Number(options.vignetteAlpha)))
    : 0.48;
  vignette.addColorStop(1, "rgba(0,5,16," + vignetteAlpha + ")");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // A thin cyber-cyan perimeter is the only full-frame solid edge.
  const inset = S(5);
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, S(16));
  ctx.save();
  ctx.shadowColor = "rgba(40,220,255,.72)";
  ctx.shadowBlur = S(8);
  ctx.strokeStyle = "rgba(91,226,255,.42)";
  ctx.lineWidth = Math.max(1, S(0.9));
  ctx.stroke();
  ctx.restore();
}
function panel(ctx, x, y, width, height, radius = THEME_STYLE.panelRadius, accent = PALETTE.accent) {
  ensureTheme();
  const palette = getCardPalette();
  ctx.save();
  roundRect(ctx, x, y, width, height, radius);
  ctx.shadowColor = "rgba(0,0,0,.46)";
  ctx.shadowBlur = S(16);
  ctx.shadowOffsetY = S(6);
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, rgba(palette.card[0], 0.70));
  gradient.addColorStop(0.52, rgba(mixHex(palette.card[0], "#ffffff", 0.025), 0.66));
  gradient.addColorStop(1, rgba(palette.card[1], 0.72));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = palette.cardBorder;
  ctx.lineWidth = Math.max(1, S(.95));
  ctx.stroke();
  roundRect(ctx, x + S(1.5), y + S(1.5), width - S(3), height - S(3), Math.max(0, radius - S(1.5)));
  ctx.strokeStyle = "rgba(230,246,255,.075)";
  ctx.lineWidth = Math.max(1, S(.7));
  ctx.stroke();

  // The short vertical light rail repeats the main-menu tile silhouette.
  const edge = ctx.createLinearGradient(x, y, x, y + height);
  edge.addColorStop(0, rgba(palette.accent, 0.92));
  edge.addColorStop(1, rgba(palette.accent, 0.14));
  ctx.fillStyle = edge;
  roundRect(ctx, x + S(1), y + S(13), S(2), Math.max(S(12), height - S(26)), S(1));
  ctx.fill();
  if (accent && accent !== PALETTE.accent) {
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = accent;
    roundRect(ctx, x + S(8), y + S(1), Math.max(S(30), Math.min(width * .2, S(100))), S(2), S(1));
    ctx.fill();
    ctx.restore();
  }
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

const RANDOM_TEXT_COLORS = Object.freeze([
  "#65e8ff", "#a1d9ff", "#8dffe8", "#c3a5ff",
  "#ffaddd", "#82b7ff", "#e6f7ff"
]);

function randomTextColor(seed = "") {
  const value = String(seed) + ":" + String(themeBackgrounds.getRenderSeed());
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return RANDOM_TEXT_COLORS[(hash >>> 0) % RANDOM_TEXT_COLORS.length];
}

function text(ctx, value, x, y, options = {}) {
  ensureTheme();
  const size = options.size || 20;
  const family = options.family || "JT";
  const requestedColor = options.color || PALETTE.ink2;
  const useRandomColor = options.randomColor === true ||
    (options.randomColor !== false &&
      [PALETTE.accent, PALETTE.accent2].includes(requestedColor));
  const color = useRandomColor ? randomTextColor(String(value) + ":" + x + ":" + y) : requestedColor;
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
  const active = brandTheme.getPalette();
  return {
    ...active,
    background: active.background.slice(),
    panel: active.panel.slice(),
    card: active.card.slice(),
    footer: active.footer.slice(),
    text: active.text || PALETTE.ink,
    muted: active.muted || PALETTE.ink2
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
  reload: resolveTheme, ensureTheme, sanitizeGlyphs, mixHex, rgba,
  randomTextColor, RANDOM_TEXT_COLORS
};
