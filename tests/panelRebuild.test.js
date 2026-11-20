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
const threadService = fs.readFileSync(path.join(root, "core/runtime/services/threadService.js"), "utf8");
const databaseAdapter = fs.readFileSync(path.join(root, "core/runtime/adapters/database.js"), "utf8");
const databaseFacade = fs.readFileSync(path.join(root, "utils/db.js"), "utf8");
const supabaseStore = fs.readFileSync(path.join(root, "core/storage/supabase.js"), "utf8");
const panelBridge = fs.readFileSync(path.join(root, "core/panelBridge.js"), "utf8");
const bridgeProfile = fs.readFileSync(path.join(root, "panel/bridgeProfile.js"), "utf8");
const botManager = fs.readFileSync(path.join(root, "panel/botManager.js"), "utf8");
const johnTran = fs.readFileSync(path.join(root, "src/app/startBot.js"), "utf8");

test("rebuilt panel JavaScript parses without browser-side dependencies", () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: "docs/panel.js" }));
});

test("Panel chat generates randomized multi-color word spans with UTF-16-safe offsets", () => {
  const start = js.indexOf("function buildRandomColorStyles(");
  const end = js.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, "random color span builder must exist");
  const source = js.slice(start, end + 2);
  const build = vm.runInNewContext("(" + source + ")", {
    ZALO_COLORS: {
      "#f43f5e":"c_db342e",
      "#f97316":"c_f27806",
      "#f59e0b":"c_f7b503",
      "#22c55e":"c_15a85f"
    }
  });
  const message = "Chào 🌈 các bạn JOHNTRAN!";
  const styles = build(message, () => 0);
  assert.deepEqual(Array.from(styles, style => message.slice(style.start, style.start + style.len)),
    ["Chào", "các", "bạn", "JOHNTRAN"]);
  assert.ok(styles.every(style => ["c_db342e","c_f27806","c_f7b503","c_15a85f"].includes(style.st)));
  assert.ok(styles.some((style, index) => index > 0 && style.st !== styles[index - 1].st),
    "adjacent words must visibly alternate colors");

  const longMessage = Array.from({ length: 240 }, (_, index) => "word" + index).join(" ");
  const longStyles = build(longMessage, () => 0.25);
  assert.equal(longStyles.length, 120, "long messages must stay within the safe style-run cap");
  const lastStyle = longStyles[longStyles.length - 1];
  assert.ok(longMessage.slice(lastStyle.start, lastStyle.start + lastStyle.len).endsWith("word239"),
    "all words, including the tail, must be included when spans are grouped");
});

test("Panel exposes a random multi-color control and preserves single-color override", () => {
  assert.match(html, /data-random-color/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(js, /state\.chatStyle\.randomColor/);
  assert.match(js, /styles\.push\(\.\.\.buildRandomColorStyles\(message\)\)/);
  assert.match(js, /randomButton\.setAttribute\("aria-pressed","false"\)/);
  assert.match(css, /\.random-color-btn\.active/);
});

test("Panel bridge validates and forwards enough safe styles for multi-color sentences", () => {
  const sendStart = panelBridge.indexOf('if (route === "/send" && req.method === "POST")');
  const sendEnd = panelBridge.indexOf('if (route === "/storage-status")', sendStart);
  const sendRoute = panelBridge.slice(sendStart, sendEnd > sendStart ? sendEnd : undefined);
  assert.match(sendRoute, /Number\.isInteger\(st\.start\)/);
  assert.match(sendRoute, /st\.start \+ st\.len <= messageText\.length/);
  assert.match(sendRoute, /allowedStyles\.has\(st\.st\)/);
  assert.match(sendRoute, /slice\(0, 128\)/);
});

test("bot cards render their status, uptime, port and action controls", () => {
  const start = js.indexOf("function renderBots()");
  const end = js.indexOf("function renderTopCommands", start);
  assert.ok(start >= 0 && end > start, "renderBots function must be present");
  const renderSource = js.slice(start, end);
  const botList = { innerHTML: "" };
  const panelState = {
    bots: [{ name: "main", displayName: "JOHNTRAN Zalo", avatar: "https://example.com/bot.png", uid: "zalo-uid", pid: 123, uptimeMs: 60000, restarts: 0, bridgePort: 3901, autoRestart: true, hasQr: false }]
  };
  // Deliberately do not expose a global "main" variable: the browser has none.
  const renderBots = vm.runInNewContext("(" + renderSource + ")", {
    state: panelState,
    $: () => botList,
    botStatus: () => ["Đang chạy", "online"],
    avatarHtml: (url, name) => '<span class="bot-avatar">' + (url ? '<img src="' + url + '" alt="' + name + '">' : name) + '</span>',
    $escape: value => String(value ?? ""),
    fmtUptime: () => "1 phút",
    number: value => Number(value) || 0
  });

  renderBots();
  for (const marker of ['class="bot-row"', 'class="status-label online"', "Uptime 1 phút", "PORT", "3901", "QR", 'data-action="bot-restart"', 'data-action="bot-logs"', "JOHNTRAN Zalo", 'src="https://example.com/bot.png"', "TÀI KHOẢN ZALO"]) {
    assert.ok(botList.innerHTML.includes(marker), "bot card is missing: " + marker);
  }
  assert.ok(!botList.innerHTML.includes("ID main"), "the internal main ID should not replace the Zalo identity");
  assert.ok(!botList.innerHTML.includes("MASTER"), "the account card should be labelled by its Zalo identity");
  assert.ok(!botList.innerHTML.includes('data-action="bot-remove"'), "the primary bot must not expose a remove action");

  panelState.bots = [{ name: "worker-1", displayName: "Worker One", pid: 456 }];
  renderBots();
  assert.ok(botList.innerHTML.includes('data-action="bot-remove"'), "child bots should keep their remove action");
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

test("Anti-Protection panel exposes every real persisted Anti mode and matching command", () => {
  const { ANTI_PROTECTION_KEYS } = require("../core/runtime/antiProtection");
  assert.ok(html.includes('id="antiProtectionPanel"'), "protection panel mount point is required");
  assert.ok(html.includes('id="antiProtectionGrid"'), "protection switch grid is required");
  assert.match(js, /data-anti-feature/);
  assert.match(js, /antiFeatures/);
  assert.ok(v4css.includes(".anti-protection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))"), "desktop protection grid should be two columns");
  assert.ok(v4css.includes(".anti-protection-switch input:checked+span"), "switch must visibly reflect enabled state");

  const registryStart = js.indexOf("const ANTI_PROTECTION_ITEMS = Object.freeze([");
  const registryEnd = js.indexOf("\n]);", registryStart);
  assert.ok(registryStart >= 0 && registryEnd > registryStart, "panel Anti registry must exist");
  const registry = js.slice(registryStart, registryEnd);
  const panelKeys = Array.from(registry.matchAll(/key:"([^"]+)"/g), match => match[1]);
  assert.equal(panelKeys.length, 21, "the panel must show all 21 Anti modes");
  assert.deepEqual([...panelKeys].sort(), [...ANTI_PROTECTION_KEYS].sort(),
    "panel switches must map one-to-one to persisted Anti keys without stale or fake modes");
  for (const key of ANTI_PROTECTION_KEYS) {
    assert.ok(registry.includes('key:"' + key + '"'), "missing Anti mode: " + key);
  }
  assert.ok(registry.includes('command:"/antiinvite"'), "Anti invite must use its dedicated command");
  assert.ok(registry.includes('command:"/antistklag"'), "Anti sticker lag must use its dedicated command");
  assert.ok(registry.includes('command:"/antisex · /antinude"'), "Anti 18+ must show its actual command and alias");
  assert.ok(registry.includes("OPENAI_API_KEY"), "AI moderation dependency must be visible");
  assert.ok(html.includes("0/21 chế độ đang bật"), "initial count must match the complete Anti registry");
  assert.ok(html.includes("quyền trưởng/phó nhóm"), "panel must explain the bot role needed for enforcement");
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

test("Panel reads a cached live Zalo profile instead of showing the internal main ID", () => {
  assert.match(panelBridge, /route === "\/profile"/);
  assert.match(panelBridge, /stats\.getProfile\(apiRef\)/);
  assert.match(bridgeProfile, /path: "\/profile"/);
  assert.match(server, /probeBridgeProfile\(out, bridgeToken\)/);
  assert.match(server, /threads\|profile\|messages/);
  assert.match(js, /function renderBotSelectors\(\)/);
  assert.match(js, /function getBotDisplayName\(nameOrBot\)/);
  assert.match(js, /getBotDisplayName\(bot\)/);
  assert.match(server, /profile\.displayName \|\| profile\.zaloName \|\| "Tài khoản Zalo"/);
  assert.doesNotMatch(js, /botProfile\?\.name \|\| "Tài khoản bot"/);
  assert.match(js, /botEnabled:typeof g\.botEnabled==="boolean"\?g\.botEnabled:null/);
  assert.match(js, /thread-bot-state is-on/);
  assert.match(js, /thread-bot-state is-off/);
  assert.match(js, /avatarHtml\(bot\.avatar, identity, "avatar-large"\)/);
  assert.match(js, /system-bot-identity/);
  assert.doesNotMatch(js, /"ID "\+bot\.name/);
  assert.match(html, /Đang tải tài khoản Zalo/);
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

test("idle group ON state survives hot-cache expiry and is warmed from persisted storage at startup", () => {
  const cache = require("../core/cache");
  assert.match(cache ? fs.readFileSync(path.join(root, "core/cache.js"), "utf8") : "", /durableThreadCache = new LRUCache\(\{ max: 10000, ttl: Infinity \}\)/);
  assert.match(controllerThreads, /durableThreadCache\.get\(key\)/);
  assert.match(controllerThreads, /return rememberThreadRecord\(record, key\)/);
  assert.match(johnTran, /threadController\.getAll\(\)/);
  assert.match(johnTran, /nạp trạng thái bot của/);

  const gid = "durable-group-cache-test";
  const record = { threadId: gid, data: { bot_enabled: true } };
  cache.threadCache.set(gid, record, -1);
  cache.durableThreadCache.set(gid, record);
  try {
    assert.equal(cache.threadCache.get(gid), undefined, "ordinary hot cache should expire");
    cache.durableThreadCache.pruneExpired();
    assert.equal(cache.durableThreadCache.get(gid)?.data?.bot_enabled, true,
      "the last committed ON flag must survive hot-cache cleanup");
  } finally {
    cache.threadCache.invalidate(gid);
    cache.durableThreadCache.invalidate(gid);
  }
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
  assert.match(panelBridge, /Threads\.setBotEnabled\(gid, body\.botEnabled\)/);
  assert.match(controllerThreads, /setBotEnabled: async \(threadId, enabled\)/);
  assert.match(controllerThreads, /bot_enabled: storedEnabled/);
  assert.match(threadService, /setBotEnabled\(\.\.\.args\)/);
  assert.match(threadService, /controller\.setBotEnabled\(\.\.\.args\)/);
  assert.match(fs.readFileSync(path.join(root, "plugins/commands/bot.js"), "utf8"), /Threads\.setBotEnabled\(threadId, enabled\)/);
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
  assert.match(bridge, /Threads\.setBotEnabled\(gid, body\.botEnabled\)/);
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
  const diagnostics = fs.readFileSync(path.join(root, "src/infrastructure/storage/diagnostics.js"), "utf8");
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
  const dispatcher = fs.readFileSync(path.join(root, "src/application/commands/dispatcher.js"), "utf8");
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

test("CI runs verification only and contains no Render deployment integration", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /^  test:/m);
  assert.doesNotMatch(workflow, /^  deploy:/m);
  assert.equal(/RENDER_API_KEY/i.test(workflow) || workflow.toLowerCase().includes("api.render.com") || workflow.toLowerCase().includes("render.com/v1/services"), false);
  assert.equal(fs.existsSync(path.join(root, "render.yaml")), false);
  assert.equal(fs.existsSync(path.join(root, "deploy/edge/render.yaml")), false);
  assert.equal(fs.existsSync(path.join(root, "docs/RENDER_STORAGE.md")), false);
});
