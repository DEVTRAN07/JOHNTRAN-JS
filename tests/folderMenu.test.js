"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const folderMenu = require("../core/runtime/folderMenu");

function command(name, category, role = 0) {
  return { config: { name, category, role, description: name + " description" } };
}

test("menu groups loaded commands into top-level folders", () => {
  global.users = { admin: ["admin-1"], support: [] };
  const commands = new Map([
    ["menu", command("menu", "Tiện ích")],
    ["stk", command("stk", "Tiện ích")],
    ["tutien", command("tutien", "Game")],
    ["restart", command("restart", "Hệ thống", 2)]
  ]);
  const folders = folderMenu.collectFolders(commands, "guest");
  assert.equal(folders.reduce((n, folder) => n + folder.count, 0), 3);
  assert.ok(folders.some(folder => folder.slug === "tienich"));
  assert.ok(!folders.some(folder => folder.name === "Hệ thống"));
  assert.equal(folderMenu.resolveFolder(commands, "guest", "tools").category, "Tiện ích");
  assert.equal(folderMenu.resolveFolder(commands, "guest", "game").category, "Game");
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
  assert.match(folderMenu.renderFolder(folder, items, "/", "JOHNTRAN", "4.0.0"), /Danh sách lệnh Tiện ích/);
});
