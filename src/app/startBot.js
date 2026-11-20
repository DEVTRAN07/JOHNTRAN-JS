const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const login = require("../../core/login");
const logger = require("../../utils/logger");
const listener = require("../../core/listen");
const loaderCommand = require("../../core/loader/loaderCommand");
const loaderEvent = require("../../core/loader/loaderEvent");
const configSystem = require("../../core/config");
const { installAxiosGuard } = require("../../core/http/axios");
const { installZaloHttpTransport } = require("../../core/http/transport");
const musicSystem = require("../../core/music");
const hotReload = require("../../core/hotReload");
const { startHealthServer } = require("../../core/health");
const { bootstrapFiles } = require("../../core/bootstrap");
const db = require("../../utils/db");
const stats = require("../../core/stats");
const schedule = require("node-schedule");
const { cleanOldMessages, getMessageCache } = require("../../utils/index");

const loginMod = login;

global.client = new Object({
    commands: new Map(),
    events: new Map(),
    cooldowns: new Map()
});

global.users = {
  admin: [],
  support: []
};

global.config = new Object();

global.api = null;

const IS_CHILD = process.env.JT_PANEL_CHILD === "1";
const BOT_TAG = process.env.JT_BOT_NAME ? ` [${process.env.JT_BOT_NAME}]` : "";

// ===== Safety net: bot 24/7 không được chết vì 1 lỗi không mong đợi =====
process.on("unhandledRejection", (reason) => {
  logger.log(`Unhandled rejection${BOT_TAG}: ${reason?.message || reason}`, "error");
  if (!global.api) {
    try {
      db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
        loginState: "failed", status: "failed",
        loginMessage: "Lỗi không xử lý khi khởi động",
        updatedAt: Date.now()
      });
    } catch { /* best effort */ }
  }
});
process.on("uncaughtException", (error) => {
  logger.log(`Uncaught exception${BOT_TAG}: ${error?.message || error}`, "error");
});

(async () => {

try {
    global.config = configSystem.load();
    global.users = {
      admin: global.config.admin_bot,
      support: global.config.support_bot
    };
    installAxiosGuard();
    const transport = installZaloHttpTransport();
    logger.log(`HTTP transport: keep-alive ${transport.options.keepAliveTimeout}ms, ${transport.options.connections} connections/origin`, "info");
    logger.log(`Đã tải cấu hệ thống thành công${BOT_TAG} (privacy guard: bật)`, "info");
    // Khôi phục account/cookie/database từ biến môi trường trước khi đăng nhập
    bootstrapFiles();
    // Load the potentially large anti-recall message cache during startup,
    // before the Zalo listener receives user traffic. The old lazy first-read
    // happened inside updateMessageCache() on the first incoming message and
    // could synchronously parse tens of thousands of JSON records.
    const cacheWarmStartedAt = Date.now();
    getMessageCache();
    logger.log(`Đã nạp message cache trước listener trong ${Date.now() - cacheWarmStartedAt}ms`, "info");
    // mở health server TRƯỚC login: cloud platform cần port mở ngay
    startHealthServer();
} catch (error) {
    logger.log(`Lỗi khi đọc config: ${error.message || error}`, "error");
    process.exit(1);
}

const tempFolderCommand = path.join(ROOT, "plugins", "commands", "temp");
const tempFolderEvent = path.join(ROOT, "plugins", "events", "temp");

try {
  if (fs.existsSync(tempFolderCommand)) {
    fs.rmSync(tempFolderCommand, { recursive: true, force: true });
    logger.log("Đã dọn dẹp folder temp của commands", "info");
  }
  if (fs.existsSync(tempFolderEvent)) {
    fs.rmSync(tempFolderEvent, { recursive: true, force: true });
    logger.log("Đã dọn dẹp folder temp của events", "info");
  }
} catch (error) {
  logger.log(`Lỗi khi dọn folder temp: ${error.message || error}`, "error");
}

logger.log("\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
for (let i = 0; i <= global.users.admin.length - 1; i++) {
    const dem = i + 1;
    logger.log(` ID ADMIN ${dem}: ${!global.users.admin[i] ? "Trống" : global.users.admin[i]}`);
}
for (let i = 0; i <= global.users.support.length - 1; i++) {
    const dem = i + 1;
    logger.log(` ID SUPPORT ${dem}: ${!global.users.support[i] ? "Trống" : global.users.support[i]}`);
}
logger.log(` NAME BOT${BOT_TAG}: ${global.config.name_bot}`);
logger.log(` PREFIX: ${global.config.prefix}`)
logger.log(` NHẠC: ${musicSystem.listProviders().map((p) => p.name.toUpperCase()).join(" • ")}`);
logger.log("┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n");
if (IS_CHILD) logger.log(`Bot con đang chạy${BOT_TAG} | pid ${process.pid}`, "info");

// Message-cache cleanup is maintenance work, not a per-minute hot-path task.
// Messages are retained for 24h, so a 15-minute sweep is sufficient and avoids
// repeatedly enumerating/serializing tens of thousands of cached messages.
schedule.scheduleJob("0 */15 * * * *", () => {
    cleanOldMessages();
});

// Snapshot trạng thái ban đầu cho panel trước khi bắt đầu đăng nhập (best-effort)
try {
  db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
    loginState: loginMod.getLoginState?.() || "starting",
    status: "starting",
    loginMessage: "Đang khởi động...",
    updatedAt: Date.now()
  });
} catch { /* best effort */ }

// Heartbeat nhẹ trước khi đăng nhập xong: ghi trạng thái đăng nhập hiện tại
// mỗi ~10s để panel thấy tiến độ, chỉ ghi khi trạng thái thay đổi (tránh ghi trùng).
let loginStatsTimer = null;
let lastLoginStatState = null;
function refreshLoginStats() {
  try {
    const state = loginMod.getLoginState?.();
    if (state === lastLoginStatState) return;
    lastLoginStatState = state;
    let status = "starting";
    let message = "Đang khởi động...";
    if (state === "cookie_login") { status = "starting"; message = "Đang đăng nhập bằng cookie..."; }
    else if (state === "qr_pending") { status = "waiting"; message = "Đang chờ quét mã QR"; }
    else if (state === "qr_scanned") { status = "waiting"; message = "Đã quét QR, chờ xác nhận"; }
    else if (state === "failed") { status = "failed"; message = "Đăng nhập thất bại"; }
    db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
      loginState: state, status, loginMessage: message, updatedAt: Date.now()
    });
  } catch { /* best effort */ }
}
refreshLoginStats();
loginStatsTimer = setInterval(() => {
  if (global.api) {
    clearInterval(loginStatsTimer);
    loginStatsTimer = null;
    return;
  }
  refreshLoginStats();
}, 10000);
loginStatsTimer.unref?.();

let api;
try {
  api = await login();
} catch (error) {
  logger.log(`Lỗi khởi động đăng nhập${BOT_TAG}: ${error.message || error}`, "error");
  try {
    db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
      loginState: "failed", status: "failed",
      loginMessage: "Lỗi khởi động đăng nhập",
      updatedAt: Date.now()
    });
  } catch { /* best effort */ }
  process.exit(1);
}

global.api = api;

if (loginStatsTimer) {
  clearInterval(loginStatsTimer);
  loginStatsTimer = null;
}

if (loginMod?.getLoginState && loginMod.getLoginState() !== 'logged_in') {
    loginMod.setLoginState?.('logged_in');
}

logger.log("Đã đăng nhập thành công", "info");

// Supabase: đợi đồng bộ mirror xong mới xử lý tin (tránh mất settings nhóm)
try {
  await db.ready?.();
} catch (error) {
  logger.log(`Chưa đồng bộ được database: ${error.message}`, "warn");
}

// Warm all known group settings before the message listener starts. The
// controller keeps a bounded process-lifetime snapshot so an idle group's
// explicit ON state is not lost when the short hot cache expires.
try {
  const threadController = require("../../core/controller/controllerThreads");
  const groupSettings = threadController.getAll();
  const enabledGroups = groupSettings.filter(row => row?.data?.bot_enabled === true).length;
  logger.log(`Đã nạp trạng thái bot của ${groupSettings.length} nhóm (${enabledGroups} đang bật)`, "info");
} catch (error) {
  logger.log(`Không thể nạp trước trạng thái nhóm: ${error.message || error}`, "warn");
}

await loaderCommand();
await loaderEvent();

if (global.config.hot_reload) {
  hotReload.start();
}

// Gửi thống kê (hồ sơ, bạn bè, nhóm) lên store để panel hiển thị
// Panel statistics are secondary to real-time chat. Keep the cached snapshot
// for 30 minutes and refresh it in the background no more than every 10 minutes.
// The initial bulk Zalo reads start only after the WebSocket listener is live.
const STATS_INTERVAL = 10 * 60 * 1000;
const STATS_INITIAL_DELAY = 60 * 1000;
let statsInFlight = false;
const sendStats = async () => {
  if (!global.api || statsInFlight) return;
  statsInFlight = true;
  try {
    const data = await stats.collectStats(global.api);
    db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
      ...data,
      status: global.api ? "online" : "starting",
      loginState: loginMod.getLoginState?.() || (global.api ? 'logged_in' : 'unknown'),
      updatedAt: Date.now()
    });
  } catch (error) {
    logger.log(`Không gửi được thống kê: ${error.message}`, "warn");
  } finally {
    statsInFlight = false;
  }
};
// Load the persisted Anti-recall cache before opening the WebSocket listener.
// Its first read parses the bounded JSON file synchronously; doing this during
// startup prevents the first command after a restart from paying that cost.
try {
  const messageCache = require("../../utils/messageCache");
  messageCache.getMessageCache();
  logger.log(
    `Đã nạp message cache (${messageCache.getMessageCacheStats().entries} tin) trước khi mở listener`,
    "info"
  );
} catch (error) {
  logger.log("Không thể nạp trước message cache: " + (error?.message || error), "warn");
}

listener(api);

// Warm/refresh Panel statistics only after the bot can already receive messages.
// This bulk task reads up to 50 group details and must never race initial command
// responses immediately after login.
const statsInitialTimer = setTimeout(sendStats, STATS_INITIAL_DELAY);
statsInitialTimer.unref?.();
const statsRefreshTimer = setInterval(sendStats, STATS_INTERVAL);
statsRefreshTimer.unref?.();

// Cầu nói panel (chat Zalo thu nhỏ) — server nội bộ localhost
require("../../core/panelBridge").start({
  api,
  port: Number(process.env.JT_BRIDGE_PORT) || 3901,
  token: process.env.JT_BRIDGE_TOKEN || global.config?.panel?.bridge_token || undefined
}).catch((error) => {
  // Bridge failure must not kill an otherwise logged-in Zalo bot, but it must
  // be visible so Panel connectivity failures are diagnosable from child logs.
  logger.log(`Không khởi động được cầu nối Panel: ${error.message || error}`, "error", {
    source: "panel-bridge-start", bot: process.env.JT_BOT_NAME || "main"
  });
});

})();
