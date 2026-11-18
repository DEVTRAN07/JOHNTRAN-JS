"use strict";

const menuPalette = require("./menuPalette");

/**
 * One palette for every JOHNTRAN Canvas output.
 * Blue Neon is the built-in brand; saved /theme selections are shared by
 * the main menu, folder cards and every command/status Canvas.
 */
function getPalette(filePath = menuPalette.THEME_FILE) {
  return menuPalette.getPalette(filePath);
}

function getThemeInfo(filePath = menuPalette.THEME_FILE) {
  return menuPalette.getThemeInfo(filePath);
}

function signature(filePath = menuPalette.THEME_FILE) {
  return JSON.stringify(getPalette(filePath));
}

module.exports = {
  getPalette,
  getThemeInfo,
  signature
};
