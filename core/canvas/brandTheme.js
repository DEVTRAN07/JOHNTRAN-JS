"use strict";

const fs = require("fs");
const menuPalette = require("./menuPalette");

const paletteCache = new Map();
const fileVersionCache = new Map();
const DEFAULT_STAT_TTL_MS = 100;

function fileVersion(filePath) {
  const now = Date.now();
  const cacheKey = String(filePath);
  const cached = fileVersionCache.get(cacheKey);
  // Render helpers call ensureTheme/palette getters many times while drawing
  // one bitmap. Throttle stat() on the production theme file only; temporary
  // files used by tests and explicit tools are always checked immediately.
  if (filePath === menuPalette.THEME_FILE &&
      cached && now - cached.checkedAt < DEFAULT_STAT_TTL_MS) {
    return cached.version;
  }

  let version = "missing";
  try {
    const stat = fs.statSync(filePath);
    version = String(stat.ino || "") + ":" + String(stat.mtimeMs) + ":" + String(stat.size);
  } catch {
    version = "missing";
  }
  fileVersionCache.set(cacheKey, { version, checkedAt: now });
  return version;
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
  if (filePath) {
    paletteCache.delete(filePath);
    fileVersionCache.delete(String(filePath));
  } else {
    paletteCache.clear();
    fileVersionCache.clear();
  }
}

module.exports = {
  getPalette,
  getThemeInfo,
  signature,
  clearCache,
  fileVersion,
  DEFAULT_STAT_TTL_MS
};
