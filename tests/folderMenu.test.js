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


test("menu shortcut lookup reuses a cached visible-group index", () => {
  global.users = { admin: ["admin-1"], support: ["support-1"] };
  const commands = new Map([
    ["noitu", command("noitu", "Game")],
    ["status", command("status", "Hệ thống", 2)],
    ["stats", command("stats", "Hệ thống", 1)]
  ]);

  const first = folderMenu.resolveMenuGroup(commands, "guest", "game");
  const second = folderMenu.resolveMenuGroup(commands, "guest", "game");
  assert.ok(first);
  assert.strictEqual(second, first, "repeated shortcut resolution should reuse the same cached group");

  const publicBotGroup = folderMenu.resolveMenuGroup(commands, "guest", "bot");
  const supportBotGroup = folderMenu.resolveMenuGroup(commands, "support-1", "bot");
  const adminBotGroup = folderMenu.resolveMenuGroup(commands, "admin-1", "bot");
  assert.equal(publicBotGroup, null);
  assert.equal(supportBotGroup.count, 1, "support sees role-1 commands but not role-2 commands");
  assert.equal(adminBotGroup.count, 2, "admins see both role-1 and role-2 commands");
});

test("menu shortcut cache refreshes on map size changes and explicit hot-reload invalidation", () => {
  global.users = { admin: [], support: [] };
  const commands = new Map([
    ["noitu", command("noitu", "Game")]
  ]);

  const before = folderMenu.resolveMenuGroup(commands, "guest", "game");
  commands.set("extra-game", command("extra-game", "Game"));
  const afterSizeChange = folderMenu.resolveMenuGroup(commands, "guest", "game");
  assert.notStrictEqual(afterSizeChange, before);
  assert.equal(afterSizeChange.count, 2);

  // Replacing a value leaves Map.size unchanged; the loader/hot-reload path
  // must explicitly invalidate the derived menu index after this mutation.
  commands.set("extra-game", command("extra-game", "Tiện ích"));
  folderMenu.invalidateMenuGroupIndex(commands);
  assert.equal(folderMenu.resolveMenuGroup(commands, "guest", "game").count, 1);
  assert.equal(folderMenu.resolveMenuGroup(commands, "guest", "tools").count, 1);
});

test("bare command can own a folder shortcut instead of opening the folder detail card", () => {
  const anti = command("anti", "Anti", 0);
  anti.config.preferCommandOnBare = true;
  const ordinaryFolderCommand = command("music", "Music", 0);

  assert.equal(folderMenu.shouldOpenMenuShortcut(anti, []), false,
    "bare /anti must execute the anti command and render its protection board");
  assert.equal(folderMenu.shouldOpenMenuShortcut(ordinaryFolderCommand, []), true,
    "ordinary bare category shortcuts should keep opening Folder Details");
  assert.equal(folderMenu.shouldOpenMenuShortcut(anti, ["on"]), false,
    "commands with arguments must continue to execute normally");
});
