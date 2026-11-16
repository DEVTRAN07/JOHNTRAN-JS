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
const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
const johnTran = fs.readFileSync(path.join(root, "JohnTran.js"), "utf8");

test("rebuilt panel JavaScript parses without browser-side dependencies", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "docs/panel.js" }));
});

test("bot cards render their status, uptime, port and action controls", () => {
  const start = js.indexOf("function renderBots()");
  const end = js.indexOf("function renderTopCommands", start);
  assert.ok(start >= 0 && end > start, "renderBots function must be present");
  const renderSource = js.slice(start, end);
  const botList = { innerHTML: "" };
  const renderBots = vm.runInNewContext("(" + renderSource + ")", {
    state: { bots: [{ name: "main", displayName: "JOHNTRAN", pid: 123, uptimeMs: 60000, restarts: 0, bridgePort: 3901, autoRestart: true, hasQr: false }] },
    $: () => botList,
    botStatus: () => ["Đang chạy", "online"],
    avatarHtml: () => '<span class="bot-avatar">JT</span>',
    $escape: value => String(value ?? ""),
    fmtUptime: () => "1 phút",
    number: value => Number(value) || 0
  });

  renderBots();
  for (const marker of ['class="bot-row"', 'class="status-label online"', "Uptime 1 phút", "PORT", "3901", "QR", 'data-action="bot-restart"', 'data-action="bot-logs"']) {
    assert.ok(botList.innerHTML.includes(marker), "bot card is missing: " + marker);
  }
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
    "databaseDetails", "systemBotList", "cacheDetails", "commandLatencyDetails", "auditLog", "settingsDrawer", "modalBackdrop"
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

test("child bridge reports its resolved port to Panel and startup failures are logged", () => {
  assert.match(botManager, /stdio: \["ignore", "pipe", "pipe", "ipc"\]/);
  assert.match(botManager, /message\.type !== "jt:panel-bridge-ready"/);
  assert.match(panelBridge, /process\.send\(\{ type: "jt:panel-bridge-ready", port: finalPort \}\)/);
  assert.match(johnTran, /Không khởi động được cầu nối Panel/);
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

test("system view checks storage in each logged-in child bot and the bot registry", () => {
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
  const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
  assert.match(server, /group-status\|storage-status/);
  assert.match(server, /storageLayout: getStorageLayout\(\)/);
  assert.match(bridge, /route === "\/storage-status"/);
  assert.match(html, /id="botStorageDetails"/);
  assert.match(js, /\/storage-status/);
  assert.match(js, /Độ bền registry/);
  assert.match(js, /Math\.min\(3,state\.bots\.length\)/);
  assert.match(botManager, /process\.env\.JT_PERSISTENT_DIR/);
  assert.match(botManager, /migrateLegacyBotFiles\(this\.name, paths\)/);
  assert.match(botManager, /migrateFileIfMissing/);
});

test("storage diagnostics never reveal Supabase secrets or silently replace a legacy registry", () => {
  const diagnostics = fs.readFileSync(path.join(root, "core/storage/diagnostics.js"), "utf8");
  const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
  assert.match(diagnostics, /JT_PERSISTENT_DIR/);
  assert.match(diagnostics, /verified-mount/);
  assert.match(botManager, /fs\.constants\.COPYFILE_EXCL/);
  assert.match(botManager, /Giữ nguyên file nguồn/);
  assert.match(botManager, /require\(\"\.\.\/core\/storage\/diagnostics\"\)/);
  assert.doesNotMatch(bridgeSafeSource(), /SUPABASE_SERVICE_KEY|SUPABASE_ANON_KEY/);
});

function bridgeSafeSource() {
  return fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
}



test("system panel exposes full command latency and handler latency metrics", () => {
  assert.match(server, /commandLatency: metrics\.getCommandLatencyStats\?\.\(10\)/);
  assert.match(server, /commandExecutionLatency: metrics\.getCommandExecutionLatencyStats\?\.\(10\)/);
  assert.match(js, /m\.commandLatency/);
  assert.match(js, /m\.commandExecutionLatency/);
  assert.match(js, /P95/);
  assert.match(html, /id="commandLatencyDetails"/);
});

test("menu shortcut and admin-group hot paths use cache invalidation", () => {
  const folderMenu = fs.readFileSync(path.join(root, "core/runtime/folderMenu.js"), "utf8");
  const loader = fs.readFileSync(path.join(root, "core/loader/loaderCommand.js"), "utf8");
  const hotReload = fs.readFileSync(path.join(root, "core/hotReload.js"), "utf8");
  const adminGroups = fs.readFileSync(path.join(root, "core/runtime/adminGroups.js"), "utf8");
  const handler = fs.readFileSync(path.join(root, "core/handle/handleCommand.js"), "utf8");
  assert.match(folderMenu, /function getMenuGroupIndex/);
  assert.match(folderMenu, /invalidateMenuGroupIndex/);
  assert.match(loader, /invalidateMenuGroupIndex\(global\.client\.commands\)/);
  assert.match(hotReload, /invalidateMenuGroupIndex\(global\.client\.commands\)/);
  assert.match(adminGroups, /DEFAULT_CACHE_TTL_MS/);
  assert.match(handler, /require\("\.\.\/runtime\/adminGroups"\)/);
  assert.doesNotMatch(handler, /readFileSync\(ADMIN_GROUPS_FILE/);
});


test("structured error monitor is protected and aggregates master plus child bot journals", () => {
  const errorJournal = fs.readFileSync(path.join(root, "core/runtime/errorJournal.js"), "utf8");
  const loggerSource = fs.readFileSync(path.join(root, "utils/logger.js"), "utf8");
  const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
  const dispatcher = fs.readFileSync(path.join(root, "core/runtime/dispatcher.js"), "utf8");
  const listener = fs.readFileSync(path.join(root, "core/listen.js"), "utf8");
  const supabase = fs.readFileSync(path.join(root, "core/storage/supabase.js"), "utf8");

  assert.match(server, /pathname === "\/api\/errors"/);
  assert.match(server, /readJournalFiles\(botPaths\(bot\.name\)\.errorLogFile/);
  assert.match(errorJournal, /MAX_FILE_BYTES/);
  assert.match(errorJournal, /rotateIfNeeded/);
  assert.match(errorJournal, /DEDUPE_WINDOW_MS/);
  assert.match(errorJournal, /uncaughtExceptionMonitor/);
  assert.match(loggerSource, /journal\.recordError/);
  assert.match(errorJournal, /SUPABASE_SERVICE_KEY/);
  assert.match(errorJournal, /set-cookie|authorization/);
  assert.match(botManager, /JT_ERROR_LOG_FILE: paths\.errorLogFile/);
  assert.match(botManager, /bot-restart-auto/);
  assert.match(botManager, /bot-restart-manual/);
  assert.match(dispatcher, /commandName, isGroup:/);
  assert.match(listener, /websocket-listener/);
  assert.match(supabase, /database-supabase/);
  assert.match(js, /errorMonitorSummary/);
  assert.match(js, /errorMonitorList/);
  assert.match(html, /id="errorMonitorSummary"/);
  assert.match(html, /id="errorMonitorList"/);
});


test("recovery monitor is authenticated, aggregates child bridge health and exposes safeguards", () => {
  const recovery = fs.readFileSync(path.join(root, "core/runtime/recovery.js"), "utf8");
  const workerPool = fs.readFileSync(path.join(root, "core/workerPool.js"), "utf8");
  const listener = fs.readFileSync(path.join(root, "core/listen.js"), "utf8");
  const supabase = fs.readFileSync(path.join(root, "core/storage/supabase.js"), "utf8");
  const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");

  assert.match(server, /pathname === "\/api\/recovery"/);
  assert.match(server, /headers: \{ "x-bridge-token": bridgeToken \}/);
  assert.match(server, /childReports/);
  assert.match(bridge, /collectRecoverySnapshot/);
  assert.match(recovery, /monitorEventLoopDelay/);
  assert.match(recovery, /RSS_CRITICAL_RATIO/);
  assert.match(recovery, /processRestartByResourcePressure: false/);
  assert.match(recovery, /groupBotStateChanges: false/);
  assert.match(workerPool, /circuitOpenUntil/);
  assert.match(workerPool, /DEFAULT_MAX_RESTARTS/);
  assert.match(listener, /computeReconnectDelay/);
  assert.match(listener, /reportComponent\("listener"/);
  assert.match(supabase, /RETRY_BASE_DELAY_MS/);
  assert.match(supabase, /nextRetryAt/);
  assert.match(botManager, /maxRestartDelayMs/);
  assert.match(html, /id="recoveryDetails"/);
  assert.match(html, /id="recoveryAlertList"/);
  assert.match(js, /api\("\/api\/recovery"\)/);
  assert.match(js, /recoveryRows/);
});


test("Render production configuration places bot registry and child data on the declared Persistent Disk", () => {
  const render = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  const docs = fs.readFileSync(path.join(root, "docs/RENDER_STORAGE.md"), "utf8");
  assert.match(render, /mountPath: \/opt\/render\/project\/data/);
  assert.match(render, /key: JT_PERSISTENT_DIR\s+value: \/opt\/render\/project\/data/);
  assert.match(render, /key: JT_DB_FILE\s+value: \/opt\/render\/project\/data\/store\.json/);
  assert.match(render, /key: JT_ACCOUNT_FILE\s+value: \/opt\/render\/project\/data\/account\.json/);
  assert.match(render, /key: JT_QRCODE_PATH\s+value: \/opt\/render\/project\/data\/qr\.png/);
  assert.match(docs, /registry BotManager, dữ liệu từng bot con/);
  assert.match(docs, /npm run verify:deployment/);
});

test("production deployment verifier never sends messages or mutates bot configuration", () => {
  const verifier = fs.readFileSync(path.join(root, "scripts/verify-deployment.js"), "utf8");
  const packageData = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(packageData.scripts["verify:deployment"]);
  assert.match(verifier, /method: "GET"/);
  assert.doesNotMatch(verifier, /\/api\/chat\/.*\/send/);
  assert.doesNotMatch(verifier, /method: "POST"/);
});


test("Panel health reports managed child login state instead of the intentionally idle master session", () => {
  const healthRoute = server.indexOf('if (pathname === "/health" && req.method === "GET")');
  const healthEnd = server.indexOf('\n      }', healthRoute);
  const healthSource = server.slice(healthRoute, healthEnd);
  assert.match(healthSource, /await maybeSyncStore\(\)/);
  assert.match(healthSource, /Promise\.all\(manager\.list\(\)\.map\(bot => enrichBotLive\(bot, bridgeToken\)\)\)/);
  assert.match(server, /async function enrichBotLive\(bot, bridgeToken = ""\)/);
  assert.match(server, /const health = await probeBridgeHealth\(out, bridgeToken\)/);
  assert.match(healthSource, /botSummary/);
  assert.match(healthSource, /const loggedIn = botSummary \? botSummary\.loggedIn > 0/);
  assert.match(healthSource, /status: manager \? "ok"/);
  assert.match(server, /loginMessage: loginMessage \|\| null/);
});

test("Panel awaits and deduplicates Supabase mirror sync before bot and child bridge reads", () => {
  assert.match(server, /let storeSyncPromise = null/);
  assert.match(server, /async function maybeSyncStore\(\{ force = false \} = \{\}\)/);
  assert.match(server, /return await storeSyncPromise/);
  const botRoute = server.indexOf('if (pathname === "/api/bots" && req.method === "GET")');
  const botSync = server.indexOf("await maybeSyncStore();", botRoute);
  assert.ok(botRoute >= 0 && botSync > botRoute, "bot registry response must wait for BotStats mirror sync");
  const chatRoute = server.indexOf('if (pathname.startsWith("/api/chat"))');
  const chatSync = server.indexOf("await maybeSyncStore();", chatRoute);
  const bridgeLookup = server.indexOf("manager.list().find((b) => b.name === botName)", chatRoute);
  assert.ok(chatRoute >= 0 && chatSync > chatRoute && chatSync < bridgeLookup,
    "child bridge login state must be read only after the shared mirror sync");
  const statsRoute = server.indexOf('if (pathname === "/api/stats" && req.method === "GET")');
  assert.ok(server.indexOf("await maybeSyncStore();", statsRoute) > statsRoute);
});

test("Render CI waits for live deployment state and verifies the deployed service health", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /services\/\$\{service_id\}\/deploys\/\$\{deploy_id\}/);
  assert.match(workflow, /deploys\?limit=20/);
  assert.match(workflow, /select\(\.commit\.id\? == \$sha\)/);
  assert.match(workflow, /\[\[ "\$deploy_status" == "live" \]\]/);
  assert.match(workflow, /serviceDetails\.url/);
  assert.match(workflow, /\$service_url\/health/);
  assert.match(workflow, /services\/\$\{service_id\}\/env-vars\?limit=100/);
  assert.match(workflow, /JT_PERSISTENT_DIR/);
  assert.match(workflow, /linked Environment Group variables/);
  assert.match(workflow, /loggedIn=false/);
  assert.match(workflow, /database: driver=supabase, sync=healthy/);
  assert.match(workflow, /Production is still using JSON, not Supabase/);
  assert.match(workflow, /consecutiveFailures/);
  assert.match(workflow, /build_failed\|pre_deploy_failed\|update_failed\|canceled/);
});
