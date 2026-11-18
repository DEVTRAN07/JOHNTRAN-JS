"use strict";

const fs = require("fs");
const menuPalette = require("./menuPalette");

/**
 * One palette for every JOHNTRAN Canvas output.
 * The main menu's Blue Neon look is the built-in brand when no /theme
 * selection has been saved. Once /theme is changed, every card follows it.
 */
function hasSavedTheme(filePath = menuPalette.THEME_FILE) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getPalette(filePath = menuPalette.THEME_FILE) {
  const selected = menuPalette.getPalette(filePath);
  if (hasSavedTheme(filePath)) return selected;

  const accent = "#62dcff";
  return {
    ...selected,
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

function signature(filePath = menuPalette.THEME_FILE) {
  const palette = getPalette(filePath);
  return JSON.stringify(palette);
}

module.exports = {
  getPalette,
  hasSavedTheme,
  signature
};
