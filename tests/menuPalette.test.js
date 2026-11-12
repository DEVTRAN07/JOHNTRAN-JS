"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const menuPalette = require("../core/canvas/menuPalette");

function temporaryThemeFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "johntran-theme-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "menu-theme.json");
}

test("menu palette defaults to the shared gold theme", t => {
  const file = temporaryThemeFile(t);
  const palette = menuPalette.getPalette(file);
  assert.equal(menuPalette.getThemeInfo(file).name, "gold");
  assert.equal(palette.accent, "#d4af37");
  assert.equal(palette.panel[0], menuPalette.getPalette(file).panel[0]);
});

test("preset changes are persisted and resolved into one shared palette", t => {
  const file = temporaryThemeFile(t);
  const selected = menuPalette.setTheme("purple", file);
  const palette = menuPalette.getPalette(file);
  assert.equal(selected.name, "purple");
  assert.equal(palette.label, menuPalette.PRESETS.purple.label);
  assert.deepEqual(palette.panel, menuPalette.getPalette(file).panel);
  assert.equal(menuPalette.getThemeInfo(file).name, "purple");
});

test("Vietnamese aliases and custom HEX colors are supported", t => {
  const file = temporaryThemeFile(t);
  assert.equal(menuPalette.setTheme("xanh dương", file).name, "ocean");
  const custom = menuPalette.setTheme("#12ABEF", file);
  assert.equal(custom.name, "custom");
  assert.equal(custom.accent, "#12abef");
  assert.match(menuPalette.getPalette(file).panel[0], /^#[0-9a-f]{6}$/);
});

test("invalid theme cannot overwrite a valid saved selection", t => {
  const file = temporaryThemeFile(t);
  menuPalette.setTheme("rose", file);
  assert.throws(() => menuPalette.setTheme("neon", file), /Theme không hợp lệ/);
  assert.equal(menuPalette.getThemeInfo(file).name, "rose");
});

test("reset restores the default palette", t => {
  const file = temporaryThemeFile(t);
  menuPalette.setTheme("crimson", file);
  assert.equal(menuPalette.setTheme("reset", file).name, "gold");
});
