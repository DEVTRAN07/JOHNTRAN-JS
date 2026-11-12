"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const folderMenu = require("../core/runtime/folderMenu");

function command(name, category, role = 0) {
  return { config: { name, category, role, description: name + " description" } };
}

test("menu groups loaded commands and uses unique slugs for custom categories", () => {
  global.users = { admin: ["admin-1"], support: [] };
  const commands = new Map([
    ["menu", command("menu", "Tiện ích")],
    ["stk", command("stk", "Tiện ích")],
    ["tutien", command("tutien", "Game")],
    ["restart", command("restart", "Hệ thống", 2)],
    ["weather", command("weather", "Thời tiết")],
    ["shop", command("shop", "Mua sắm")]
  ]);
  const folders = folderMenu.collectFolders(commands, "guest");
  assert.equal(folders.reduce((n, folder) => n + folder.count, 0), 5);
  assert.ok(folders.some(folder => folder.slug === "tienich"));
  assert.ok(!folders.some(folder => folder.name === "Hệ thống"));
  assert.equal(folderMenu.resolveFolder(commands, "guest", "tools").category, "Tiện ích");
  assert.equal(folderMenu.resolveFolder(commands, "guest", "game").category, "Game");
  assert.notEqual(
    folderMenu.resolveFolder(commands, "guest", "tho i tiet")?.slug,
    folderMenu.resolveFolder(commands, "guest", "mua sam")?.slug
  );
});

test("folder command list contains only commands from the selected category", () => {
  global.users = { admin: [], support: [] };
  const commands = new Map([
    ["stk", command("stk", "Tiện ích")],
    ["getlink", command("getlink", "Tiện ích")],
    ["tutien", command("tutien", "Game")]
  ]);
  const folder = folderMenu.resolveFolder(commands, "u1", "tools");
  const items = folderMenu.collectFolderCommands(commands, "u1", folder);
  assert.deepEqual(items.map(item => item.name), ["getlink", "stk"]);
  assert.match(folderMenu.renderFolder(folder, items, "/", "JOHNTRAN", "4.0.0"), /Danh sách lệnh/);
});

test("folder tổng returns all visible commands grouped by category", () => {
  global.users = { admin: [], support: [] };
  const commands = new Map([
    ["stk", command("stk", "Tiện ích")],
    ["tutien", command("tutien", "Game")],
    ["secret", command("secret", "Hệ thống", 2)]
  ]);
  const groups = folderMenu.collectAllCommands(commands, "guest");
  const output = folderMenu.renderAllCommands(groups, "/", "JOHNTRAN", "4.0.0");
  assert.match(output, /TOÀN BỘ LỆNH/);
  assert.match(output, /\/stk/);
  assert.match(output, /\/tutien/);
  assert.doesNotMatch(output, /\/secret/);
});

test("all-folder keywords are normalized", () => {
  for (const value of ["tổng", "tong", "all", "total", "tất cả"]) {
    assert.ok(folderMenu.ALL_FOLDER_KEYS.has(folderMenu.normalizeFolder(value)));
  }
});
