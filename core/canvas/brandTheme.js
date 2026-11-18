"use strict";

const fs = require("fs");
const menuPalette = require("./menuPalette");

const paletteCache = new Map();

function fileVersion(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return String(stat.ino || "") + ":" + String(stat.mtimeMs) + ":" + String(stat.size);
  } catch {
    return "missing";
  }
}

/**
 * One palette for every JOHNTRAN Canvas output.
 * Blue Neon is the built-in brand; saved /theme selections are shared by
 * the main menu, folder cards and every command/status Canvas.
 *
 * Cache the resolved palette by the theme file's stat signature so
 * Canvas drawing helpers do not perform synchronous disk reads per text call.
 */
function getPalette(filePath = menuPalette.THEME_FILE) {
  const version = fileVersion(filePath);
  const cached = paletteCache.get(filePath);
  if (cached && cached.version === version) return cached.palette;

  const palette = menuPalette.getPalette(filePath);
  paletteCache.set(filePath, { version, palette });
  return palette;
}

function getThemeInfo(filePath = menuPalette.THEME_FILE) {
  // Refresh the shared palette cache after a theme file was created/replaced.
  getPalette(filePath);
  return menuPalette.getThemeInfo(filePath);
}

function signature(filePath = menuPalette.THEME_FILE) {
  getPalette(filePath);
  return paletteCache.get(filePath)?.version || "missing";
}

function clearCache(filePath) {
  if (filePath) paletteCache.delete(filePath);
  else paletteCache.clear();
}

module.exports = {
  getPalette,
  getThemeInfo,
  signature,
  clearCache,
  fileVersion
};
