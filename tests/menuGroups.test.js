"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const menu = require("../core/runtime/folderMenu");

function command(name, category, extra = {}) {
  return { config: { name, category, role: 0, ...extra } };
}

test("menu always exposes the eleven reference folders in the reference order", () => {
  global.users = { admin: [], support: [] };
  const commands = new Map([
    ["id", command("id", "Tiện ích")],
    ["getlink", command("getlink", "Tiện ích")],
    ["scl", command("scl", "Nhạc")],
    ["tutien", command("tutien", "Game")],
    ["smoke", command("smoke", "Thử nghiệm")],
    ["anti", command("anti", "Nhóm")],
    ["adduser", command("adduser", "Nhóm")],
    ["restart", command("restart", "Hệ thống")],
    ["cmd", command("cmd", "Hệ thống")],
    ["secret", command("secret", "Khác")]
  ]);

  const groups = menu.collectMenuGroups(commands, "guest");
  assert.deepEqual(groups.map(group => group.slug), [
    "info", "public", "music", "game", "tools", "test",
    "anti", "manager", "admin", "mybot", "hidden"
  ]);
  assert.equal(groups.find(group => group.slug === "test").count, 1);
  assert.equal(groups.find(group => group.slug === "hidden").count, 1);
});

test("test-category commands are classified into the Test folder", () => {
  assert.equal(menu.menuGroupForCommand(command("smoke", "Thử nghiệm")), "test");
  assert.equal(menu.menuGroupForCommand(command("check", "Kiểm thử")), "test");
  assert.equal(menu.menuGroupForCommand(command("debug", "testing")), "test");
});

test("empty visible folders can still be resolved by their shortcut", () => {
  global.users = { admin: [], support: [] };
  const groups = new Map([
    ["id", command("id", "Tiện ích")]
  ]);
  assert.equal(menu.resolveMenuGroup(groups, "guest", "test").slug, "test");
  assert.deepEqual(menu.collectMenuGroupCommands(groups, "guest", { slug: "test" }), []);
});
