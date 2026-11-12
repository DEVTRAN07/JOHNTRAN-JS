"use strict";

const fs = require("fs");
const path = require("path");

const THEME_FILE = path.join(__dirname, "..", "..", "data", "menu-theme.json");
const DEFAULT_THEME = "gold";
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

const PRESETS = Object.freeze({
  gold: Object.freeze({
    label: "Gold · Đen nhũ vàng",
    accent: "#d4af37",
    background: ["#08080a", "#17140d", "#302516", "#0b0907"],
    panel: ["#3a2b12", "#1c170d"],
    card: ["#2d2618", "#1c1a12"],
    footer: ["#17140d", "#0d0b08"]
  }),
  ocean: Object.freeze({
    label: "Ocean · Xanh đại dương",
    accent: "#55d6e8",
    background: ["#06131f", "#0b2b40", "#124d5d", "#071a29"],
    panel: ["#0d5367", "#082f43"],
    card: ["#183b50", "#102b3d"],
    footer: ["#0a2638", "#071927"]
  }),
  purple: Object.freeze({
    label: "Purple · Tím huyền bí",
    accent: "#c4a4ff",
    background: ["#100b1d", "#26173a", "#483064", "#160e25"],
    panel: ["#493064", "#2a1b43"],
    card: ["#33264a", "#211a34"],
    footer: ["#211630", "#130e20"]
  }),
  emerald: Object.freeze({
    label: "Emerald · Xanh ngọc",
    accent: "#7ce0b5",
    background: ["#061811", "#0c3528", "#155542", "#071e17"],
    panel: ["#12513d", "#092d23"],
    card: ["#194536", "#102f25"],
    footer: ["#0d2a20", "#071a14"]
  }),
  rose: Object.freeze({
    label: "Rose · Hồng khói",
    accent: "#ff9fc5",
    background: ["#1d0b17", "#3d172b", "#662a48", "#210d1b"],
    panel: ["#71314f", "#421d36"],
    card: ["#4b2b40", "#321d2c"],
    footer: ["#321526", "#1d0d18"]
  }),
  crimson: Object.freeze({
    label: "Crimson · Đỏ ruby",
    accent: "#ff8e8e",
    background: ["#1d090d", "#3c101b", "#641f2c", "#220a11"],
    panel: ["#6a1f30", "#3d1320"],
    card: ["#4b2430", "#321820"],
    footer: ["#32111b", "#1d0b11"]
  })
});

const ALIASES = Object.freeze({
  default: "gold", reset: "gold", editorial: "gold", classic: "gold", vang: "gold",
  blue: "ocean", xanhduong: "ocean", bien: "ocean",
  tim: "purple",
  green: "emerald", xanhla: "emerald", ngoc: "emerald",
  pink: "rose", hong: "rose",
  red: "crimson", do: "crimson"
});

function normalizeName(value) {
  return String(value || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
}

function resolvePreset(value) {
  const key = normalizeName(value);
  const name = ALIASES[key] || key;
  return Object.prototype.hasOwnProperty.call(PRESETS, name) ? name : null;
}

function rgba(hex, alpha) {
  const value = String(hex).replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return "rgba(" + red + "," + green + "," + blue + "," + alpha + ")";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl(hex) {
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 1);
  const lightness = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;
  let rgb;
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return "#" + rgb.map(channel =>
    Math.round((channel + m) * 255).toString(16).padStart(2, "0")
  ).join("");
}

function createCustomPalette(hex) {
  const { h, s } = rgbToHsl(hex);
  const saturation = clamp(s * 0.66, 0.22, 0.58);
  const shade = lightness => hslToHex(h, saturation, lightness);
  return {
    label: "Tùy chỉnh " + hex.toUpperCase(),
    accent: hex.toLowerCase(),
    background: [shade(0.045), shade(0.085), shade(0.135), shade(0.055)],
    panel: [shade(0.24), shade(0.15)],
    card: [shade(0.19), shade(0.12)],
    footer: [shade(0.12), shade(0.07)]
  };
}

function withDerivedColors(source) {
  const accent = source.accent;
  return {
    ...source,
    border: rgba(accent, 0.62),
    cardBorder: rgba(accent, 0.44),
    glow: [rgba(accent, 0.22), rgba(accent, 0.11)],
    infoFill: rgba(accent, 0.11),
    infoBorder: rgba(accent, 0.62),
    text: "#f7f8ff",
    muted: "#cbd5e4"
  };
}

function getThemeState(filePath = THEME_FILE) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (saved && HEX_PATTERN.test(String(saved.customHex || ""))) {
      return { name: "custom", customHex: String(saved.customHex).toLowerCase() };
    }
    const name = resolvePreset(saved?.name);
    if (name) return { name, customHex: null };
  } catch {
    // Missing or invalid file uses the built-in default.
  }
  return { name: DEFAULT_THEME, customHex: null };
}

function getPalette(filePath = THEME_FILE) {
  const state = getThemeState(filePath);
  const source = state.customHex
    ? createCustomPalette(state.customHex)
    : PRESETS[state.name] || PRESETS[DEFAULT_THEME];
  return withDerivedColors(source);
}

function getThemeInfo(filePath = THEME_FILE) {
  const state = getThemeState(filePath);
  const palette = getPalette(filePath);
  return {
    ...state,
    label: palette.label,
    accent: palette.accent
  };
}

function setTheme(value, filePath = THEME_FILE) {
  const raw = String(value || "").trim();
  let saved;
  if (HEX_PATTERN.test(raw)) {
    saved = { name: "custom", customHex: raw.toLowerCase() };
  } else {
    const name = resolvePreset(raw);
    if (!name) {
      throw new Error("Theme không hợp lệ. Hãy chọn preset có sẵn hoặc nhập mã màu #RRGGBB.");
    }
    saved = { name, customHex: null };
  }

  const parent = path.dirname(filePath);
  const temporary = filePath + "." + process.pid + ".tmp";
  fs.mkdirSync(parent, { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), "utf8");
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* no temporary file */ }
    throw new Error("Không thể lưu theme: " + error.message);
  }
  return getThemeInfo(filePath);
}

function getPresetList() {
  return Object.entries(PRESETS).map(([name, palette]) => ({
    name,
    label: palette.label,
    accent: palette.accent
  }));
}

module.exports = {
  DEFAULT_THEME, PRESETS, THEME_FILE,
  getThemeState, getPalette, getThemeInfo, setTheme, getPresetList,
  normalizeName, resolvePreset, HEX_PATTERN
};
