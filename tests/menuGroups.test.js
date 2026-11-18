"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const menu = require("../core/runtime/folderMenu");

function command(name, category, role = 0, extra = {}) {
  return { config: { name, category, role, ...extra } };
}

test("menu shows only populated folders in the reference order", () => {
  global.users = { admin: ["root"], support: ["root"] };
  const commands = new Map([
    ["id", command("id", "Tiện ích")],
    ["getlink", command("getlink", "Tiện ích")],
    ["scl", command("scl", "Nhạc")],
    ["noitu", command("noitu", "Game")],
    ["autodown", command("autodown", "Tiện ích")],
    ["anti", command("anti", "Nhóm", 1)],
    ["delmsg", command("delmsg", "Nhóm")],
    ["restart", command("restart", "Hệ thống", 2)],
    ["command", command("command", "Hệ thống", 2)],
    ["girl", command("girl", "Giải trí")],
    ["noi", command("noi", "AI")]
  ]);

  const groups = menu.collectMenuGroups(commands, "root");
  assert.deepEqual(groups.map(group => group.slug), [
    "info", "public", "music", "game", "tools",
    "anti", "manager", "admin", "bot", "hidden"
  ]);
  assert.ok(groups.every(group => group.count > 0));
  assert.ok(!groups.some(group => group.slug === "test"));
});

test("menu folders use clear English display names", () => {
  const commands = new Map([
    ["id", command("id", "Tiện ích")],
    ["scl", command("scl", "Nhạc")],
    ["dhbc", command("dhbc", "Game")],
    ["anti", command("anti", "Nhóm")],
    ["restart", command("restart", "Hệ thống")],
    ["command", command("command", "Hệ thống")],
    ["girl", command("girl", "Giải trí")]
  ]);
  const groups = menu.collectMenuGroups(commands, "guest");
  const names = Object.fromEntries(groups.map(group => [group.slug, group.name]));
  assert.equal(names.info, "Info");
  assert.equal(names.music, "Music");
  assert.equal(names.game, "Game");
  assert.equal(names.anti, "Anti");
  assert.equal(names.admin, "Admin");
  assert.equal(names.bot, "Bot");
  assert.equal(names.hidden, "Special");
  assert.ok(!groups.some(group => group.slug === "test"));
});

test("each live command is assigned to its intended folder", () => {
  const cases = [
    ["id", "Tiện ích", "info"],
    ["infofb", "Tiện ích", "info"],
    ["card", "Tiện ích", "public"],
    ["getavt", "Tiện ích", "public"],
    ["getlink", "Tiện ích", "public"],
    ["getvd", "Tiện ích", "public"],
    ["getvoice", "Tiện ích", "public"],
    ["tiktok", "Tiện ích", "public"],
    ["scl", "Nhạc", "music"],
    ["lyric", "Nhạc", "music"],
    ["noitu", "Game", "game"],
    ["autodown", "Tiện ích", "tools"],
    ["autosend", "Tiện ích", "tools"],
    ["anti", "Nhóm", "anti"],
    ["autokick", "Nhóm", "anti"],
    ["antinude", "Anti", "anti"],
    ["antirecall", "Anti", "anti"],
    ["antilink", "Anti", "anti"],
    ["antispam", "Anti", "anti"],
    ["antinude", "Quản lý nhóm", "anti"],
    ["antirecall", "Quản lý nhóm", "anti"],
    ["antilink", "Quản lý nhóm", "anti"],
    ["antispam", "Quản lý nhóm", "anti"],
    ["banmember", "Quản lý nhóm", "manager"],
    ["adduser", "Nhóm", "manager"],
    ["delmsg", "Nhóm", "manager"],
    ["adc", "Hệ Thống", "admin"],
    ["admin", "Hệ thống", "admin"],
    ["reloadconfig", "Hệ thống", "admin"],
    ["restart", "Hệ thống", "admin"],
    ["theme", "Hệ thống", "admin"],
    ["spam", "Hệ thống", "admin"],
    ["spamsticker", "Hệ thống", "admin"],
    ["bot", "Hệ thống", "bot"],
    ["command", "Hệ thống", "bot"],
    ["events", "Hệ thống", "bot"],
    ["jobs", "Hệ thống", "bot"],
    ["stats", "Hệ thống", "bot"],
    ["status", "MyBot", "bot"],
    ["mybot", "MyBot", "bot"],
    ["girl", "Giải trí", "hidden"],
    ["hon", "Hành động", "hidden"],
    ["noi", "AI", "hidden"],
    ["vdgirl", "Giải trí", "hidden"]
  ];

  for (const [name, category, expected] of cases) {
    assert.equal(
      menu.menuGroupForCommand(command(name, category)),
      expected,
      `command ${name} should belong to ${expected}`
    );
  }
});

test("all current Anti commands route to Anti instead of Special", () => {
  const commands = new Map([
    ["anti", command("anti", "Anti", 0)],
    ["antinude", command("antinude", "Anti", 0)],
    ["antirecall", command("antirecall", "Anti", 0)],
    ["antilink", command("antilink", "Anti", 0)],
    ["antispam", command("antispam", "Anti", 0)],
    ["autokick", command("autokick", "Nhóm", 1)]
  ]);
  const groups = menu.collectMenuGroups(commands, "guest");
  const antiGroup = groups.find(group => group.slug === "anti");
  assert.equal(antiGroup?.count, 5, "public Anti commands should be grouped together");
  assert.deepEqual(antiGroup?.commands.map(item => item.name), [
    "anti", "antilink", "antinude", "antirecall", "antispam"
  ]);
  assert.ok(!groups.some(group => group.slug === "hidden"), "Anti commands must not leak into Special");
});

test("Test folder appears only when a real test command exists", () => {
  const commands = new Map([["id", command("id", "Tiện ích")]]);
  assert.ok(!menu.collectMenuGroups(commands, "guest").some(group => group.slug === "test"));

  commands.set("smoke", command("smoke", "Thử nghiệm"));
  const testFolder = menu.collectMenuGroups(commands, "guest").find(group => group.slug === "test");
  assert.equal(testFolder?.count, 1);
  assert.equal(testFolder?.commands[0]?.name, "smoke");
});

test("empty folders cannot be opened as shortcuts", () => {
  const commands = new Map([["id", command("id", "Tiện ích")]]);
  assert.equal(menu.resolveMenuGroup(commands, "guest", "test"), null);
  assert.deepEqual(
    menu.collectMenuGroupCommands(commands, "guest", { slug: "test" }),
    []
  );
});
