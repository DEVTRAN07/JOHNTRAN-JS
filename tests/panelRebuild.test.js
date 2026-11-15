"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs/panel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "docs/panel.css"), "utf8");
const js = fs.readFileSync(path.join(root, "docs/panel.js"), "utf8");
const server = fs.readFileSync(path.join(root, "panel/server.js"), "utf8");

test("rebuilt panel JavaScript parses without browser-side dependencies", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "docs/panel.js" }));
});

test("new panel shell has all six views and their required mount points", () => {
  for (const view of ["overview", "chat", "commands", "groups", "profile", "system"]) {
    assert.match(html, new RegExp('id="view-' + view + '"'));
  }
  for (const id of [
    "metricsGrid", "botList", "threadList", "messageList", "chatWorkspace",
    "commandFolders", "commandFolderTitle", "commandGrid", "commandStatusList",
    "groupBotSelect", "groupSelect", "groupCommandList",
    "profileDetails", "friendList", "profileGroupList", "systemDetails",
    "databaseDetails", "systemBotList", "cacheDetails", "auditLog", "settingsDrawer", "modalBackdrop"
  ]) {
    assert.ok(html.includes('id="' + id + '"'), "missing panel mount point: " + id);
  }
});

test("panel frontend is self-hosted and has no external runtime dependency", () => {
  assert.match(html, /href="panel\.css"/);
  assert.match(html, /src="panel\.js"/);
  assert.doesNotMatch(html, /https:\/\/(?:cdn\.|unpkg\.com|fonts\.googleapis\.com)/i);
  assert.match(css, /@media\(max-width:680px\)/);
});

test("dashboard keeps using the existing protected panel API and bridge routes", () => {
  for (const endpoint of [
    "/api/bots", "/api/metrics", "/api/commands", "/api/commands/status",
    "/api/stats", "/api/chat/"
  ]) assert.ok(js.includes(endpoint), "missing API integration: " + endpoint);
  assert.match(server, /isPanelRequestAuthorized/);
  assert.match(server, /STATIC_FILES/);
  assert.ok(server.includes("panel\\.(css|js)"));
  assert.doesNotMatch(server, /DASHBOARD_HTML/);
});

test("panel token is only persisted for the current browser session", () => {
  assert.match(js, /sessionStorage\.setItem\("jt_panel_token"/);
  assert.match(js, /sessionStorage\.removeItem\("jt_panel_token"/);
  assert.match(js, /localStorage\.setItem\("jt_panel_url"/);
  assert.doesNotMatch(js, /localStorage\.setItem\(["']jt_panel_token/);
});


test("Render root URL opens the new control center and legacy status page has its own route", () => {
  assert.match(server, /const STATIC_FILES = \{ "\/": "panel\.html", "\/panel": "panel\.html", "\/panel\.html": "panel\.html", "\/status": "index\.html"/);
});

test("command folders reuse the exact /menu classifier rather than raw command categories", () => {
  const folderMenu = require("../core/runtime/folderMenu");
  assert.equal(folderMenu.menuGroupForCommand({ config: { name: "scl", category: "Nhạc" } }), "music");
  assert.equal(folderMenu.menuGroupForCommand({ config: { name: "dhbc", category: "Game" } }), "game");
  assert.equal(folderMenu.menuGroupForCommand({ config: { name: "stk", category: "Tiện ích" } }), "tools");
  assert.equal(folderMenu.MENU_GROUPS.length, 11);
  assert.match(fs.readFileSync(path.join(root, "panel/server.js"), "utf8"), /menuGroupForCommand/);
});

test("group command settings are proxied to the selected bot bridge, not master global.client", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  assert.match(server, /group-commands/);
  assert.match(bridge, /route === "\/group-commands"/);
  assert.match(bridge, /Threads\.getData\(gid\)/);
  assert.match(bridge, /Threads\.setData\(gid, data\)/);
  assert.match(js, /\/api\/chat\/.*group-commands/);
  assert.doesNotMatch(server, /global\.client\.commands/);
});

test("profile endpoint includes each child bot store and UI reads live Zalo bridge data", () => {
  assert.match(server, /findBotStatsRow\(bot\.name\)/);
  assert.match(js, /\/api\/chat\/.*\/threads/);
  assert.match(js, /loginState: "logged_in"/);
});

test("system view exposes database and individual bot health", () => {
  assert.match(html, /id="databaseDetails"/);
  assert.match(html, /id="systemBotList"/);
  assert.match(js, /consecutiveFailures/);
  assert.match(js, /systemBotList/);
});

test("group command proxy preserves the gid query string for POST updates", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  assert.match(server, /if \(url\.search\) target \+= url\.search/);
  assert.match(server, /if \(req\.method === "POST"\) \{\s*req\.pipe\(proxyReq\)/);
  assert.match(bridge, /const gid = String\(url\.searchParams\.get\("gid"\)/);
});
