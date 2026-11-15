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
    "commandGrid", "commandStatusList", "groupCommandList",
    "profileDetails", "friendList", "profileGroupList", "systemDetails",
    "cacheDetails", "auditLog", "settingsDrawer", "modalBackdrop"
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
    "/api/groups/", "/api/stats", "/api/chat/"
  ]) assert.ok(js.includes(endpoint), "missing API integration: " + endpoint);
  assert.match(server, /isPanelRequestAuthorized/);
  assert.match(server, /STATIC_FILES/);
  assert.match(server, /panel\.css\|js/);
  assert.doesNotMatch(server, /DASHBOARD_HTML/);
});

test("panel token is only persisted for the current browser session", () => {
  assert.match(js, /sessionStorage\.setItem\("jt_panel_token"/);
  assert.match(js, /sessionStorage\.removeItem\("jt_panel_token"/);
  assert.match(js, /localStorage\.setItem\("jt_panel_url"/);
  assert.doesNotMatch(js, /localStorage\.setItem\(["']jt_panel_token/);
});
