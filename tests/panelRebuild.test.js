"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs/panel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "docs/panel.css"), "utf8");
const v4css = fs.readFileSync(path.join(root, "docs/panel.v4.css"), "utf8");
const js = fs.readFileSync(path.join(root, "docs/panel.js"), "utf8");
const server = fs.readFileSync(path.join(root, "panel/server.js"), "utf8");
const controllerThreads = fs.readFileSync(path.join(root, "core/controller/controllerThreads.js"), "utf8");
const databaseAdapter = fs.readFileSync(path.join(root, "core/runtime/adapters/database.js"), "utf8");
const databaseFacade = fs.readFileSync(path.join(root, "utils/db.js"), "utf8");
const supabaseStore = fs.readFileSync(path.join(root, "core/storage/supabase.js"), "utf8");
const panelBridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");

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

test("V4 theme is self-hosted and group browser exposes status filters and sorting", () => {
  assert.match(html, /href="panel\.v4\.css"/);
  assert.match(server, /"\/panel\.v4\.css": "panel\.v4\.css"/);
  assert.match(v4css, /group-filter-tabs/);
  assert.match(v4css, /group-sort/);
  for (const filter of ["all", "on", "off"]) {
    assert.ok(html.includes('data-group-filter="' + filter + '"'));
  }
  assert.match(html, /id="groupSort"/);
  assert.match(js, /members-desc/);
  assert.match(js, /status-on-first/);
});

test("group status polling uses a lightweight authenticated bot bridge route", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  assert.match(server, /group-commands\|group-status/);
  assert.match(bridge, /route === "\/group-status"/);
  assert.match(bridge, /getGroupBotStateSnapshot\(Threads\.getAll\(\)\)/);
  assert.match(js, /\/group-status/);
  assert.match(js, /}, 15000\)/);
  assert.match(js, /document\.visibilityState === "visible"/);
});

test("group avatars are lazy-loaded and failed images degrade to initials without full-card refresh", () => {
  assert.match(js, /loading="lazy" decoding="async" fetchpriority="low"/);
  assert.match(js, /failedGroupAvatarUrls\.add\(key\)/);
  assert.match(js, /function syncGroupCardStatuses/);
  assert.match(v4css, /group-card-avatar img\.loaded/);
});

test("group toggles wait for durable storage and pending Supabase writes survive stale sync", () => {
  assert.match(controllerThreads, /saveDataAndWait\("Threads", "threadId", key, record\.data\)/);
  assert.match(databaseAdapter, /saveDataAndWait/);
  assert.match(databaseFacade, /async saveDataAndWait/);
  assert.match(supabaseStore, /async setAndWait/);
  assert.match(supabaseStore, /A remote snapshot can be older than a local write still in flight/);
});

test("bulk group actions are explicit, confirmed and rate-limited", () => {
  for (const id of ["groupSelectVisible", "groupBulkCount", "groupClearSelection"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing bulk control: " + id);
  }
  assert.match(html, /data-group-bulk-action="on"/);
  assert.match(html, /data-group-bulk-action="off"/);
  assert.match(js, /state\.selectedGroupIds/);
  assert.match(js, /window\.confirm\(/);
  assert.match(js, /offset \+= 4/);
  assert.match(js, /groupBulkFlight/);
  assert.match(v4css, /group-bulk-bar/);
  assert.match(v4css, /group-card-select/);
});

test("unavailable group storage is shown as UNKNOWN, never falsely as OFF", () => {
  assert.match(panelBridge, /botEnabled: null/);
  assert.match(panelBridge, /await ensureThreadStoreReady\(\)/);
  assert.match(js, /CHƯA XÁC MINH/);
  assert.match(js, /typeof group\.botEnabled !== "boolean"/);
});

test("group config routes check database readiness before creating any default-OFF group record", () => {
  const routeStart = panelBridge.indexOf('if (route === "/group-commands")');
  const readyCheck = panelBridge.indexOf("await ensureThreadStoreReady();", routeStart);
  const firstGroupRead = panelBridge.indexOf("Threads.getData(gid)", routeStart);
  assert.ok(routeStart >= 0 && readyCheck > routeStart && readyCheck < firstGroupRead);
  assert.match(panelBridge, /Database nhóm chưa sẵn sàng/);
});

test("existing group settings keep the fast write path while explicit bot toggles await durable storage", () => {
  assert.match(controllerThreads, /setData: \(threadId, data\) =>/);
  assert.match(controllerThreads, /setDataAndWait: async \(threadId, data\) =>/);
  assert.match(panelBridge, /Threads\.setDataAndWait\(gid, data\)/);
  assert.match(fs.readFileSync(path.join(root, "plugins/commands/bot.js"), "utf8"), /setDataAndWait \|\| Threads\.setData/);
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

test("group settings expose a master bot switch and real bot/group identities", () => {
  for (const id of ["groupIdentityGrid", "groupBotIdentity", "selectedGroupIdentity", "groupBotToggleRow", "groupBotEnabled", "groupBotToggleLabel"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing group control: " + id);
  }
  assert.match(js, /botEnabled: enabled/);
  assert.match(js, /data\.botEnabled === true/);
  assert.match(js, /botProfile\?\.displayName/);
  assert.match(js, /group\.avatar \|\| group\.avt/);
  assert.match(server, /out\.displayName/);
  assert.match(server, /out\.avatar/);
});

test("group-level bot switch is persisted in the selected bot process and OFF is silent", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  const listener = fs.readFileSync(path.join(root, "core/listen.js"), "utf8");
  const handler = fs.readFileSync(path.join(root, "core/handle/handleCommand.js"), "utf8");
  assert.match(bridge, /botEnabled: thread\.data\?\.bot_enabled === true/);
  assert.match(bridge, /data\.bot_enabled = body\.botEnabled/);
  assert.match(bridge, /Threads\.setData\(gid, data\)/);
  assert.match(listener, /groupBotEnabled/);
  assert.match(listener, /isAllowedBotControlMessage/);
  assert.match(fs.readFileSync(path.join(root, "core/handle/handleEvent.js"), "utf8"), /isGroupBotEnabled/);
  assert.match(handler, /canRunCommandInGroup/);
});

test("bot menu folder uses /bot and keeps /mybot as a backward-compatible route", () => {
  const folderMenu = require("../core/runtime/folderMenu");
  assert.equal(folderMenu.MENU_GROUPS.find(folder => folder.name === "Bot")?.slug, "bot");
  const botCommands = new Map([["bot", { config: { name: "bot", category: "Hệ thống" } }]]);
  assert.equal(folderMenu.resolveMenuGroup(botCommands, "owner", "bot")?.slug, "bot");
  assert.equal(folderMenu.resolveMenuGroup(botCommands, "owner", "mybot")?.slug, "bot");
  assert.equal(folderMenu.menuGroupForCommand({ config: { name: "bot", category: "Hệ thống" } }), "bot");
});
test("group command proxy preserves the gid query string for POST updates", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  assert.match(server, /if \(url\.search\) target \+= url\.search/);
  assert.match(server, /if \(req\.method === "POST"\) \{\s*req\.pipe\(proxyReq\)/);
  assert.match(bridge, /const gid = String\(url\.searchParams\.get\("gid"\)/);
});


test("database panel exposes protected durability diagnostics for Supabase and Render JSON", () => {
  assert.match(server, /\/api\/database\/health/);
  assert.match(server, /await dbUtils\.healthCheck\(\)/);
  assert.match(databaseFacade, /function inspectPersistentDisk/);
  assert.match(databaseFacade, /mounted_and_used/);
  assert.match(databaseFacade, /databaseFileOnDisk/);
  assert.match(js, /api\("\/api\/database\/health"\)/);
  assert.match(databaseFacade, /JT_PERSISTENT_DIR/);
  assert.match(js, /Persistent Disk/);
  assert.match(js, /bot_threads/);
  assert.match(html, /id="databaseDetails"/);
});
