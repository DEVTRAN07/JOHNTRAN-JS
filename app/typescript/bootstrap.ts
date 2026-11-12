import fs from "fs";
import path from "path";
import login, { getLoginState, setLoginState } from "./shared/auth/login";
import logger from "./shared/logger";
import listener from "./shared/events/listener";
import loaderCommand from "./shared/commands/loaderCommand";
import loaderEvent from "./shared/events/loaderEvent";
import { load } from "./shared/config";
import { installAxiosGuard } from "./shared/http/axios";
import musicSystem from "./shared/media/music";
import hotReload from "./shared/utils/hotReload";
import lazyLoader from "./shared/utils/lazyLoader";
import { startHealthServer } from "./shared/monitoring/health";
import { bootstrapFiles } from "./shared/utils/bootstrap";
import db from "./shared/database/db";
import stats from "./shared/monitoring/stats";
import schedule from "node-schedule";
import { cleanOldMessages } from "./shared/utils";

const IS_CHILD = process.env.JT_PANEL_CHILD === "1";
const BOT_TAG = process.env.JT_BOT_NAME ? ` [${process.env.JT_BOT_NAME}]` : "";

// ===== Safety net: bot 24/7 không được chết vì 1 lỗi không mong đợi =====
process.on("unhandledRejection", (reason: unknown) => {
  logger.log(`Unhandled rejection${BOT_TAG}: ${reason instanceof Error ? reason.message : String(reason)}`, "error");
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
process.on("uncaughtException", (error: Error) => {
  logger.log(`Uncaught exception${BOT_TAG}: ${error?.message || error}`, "error");
});

(async (): Promise<void> => {

try {
    global.config = load();
    global.users = {
      admin: global.config.admin_bot,
      support: global.config.support_bot
    };
    installAxiosGuard();
    logger.log(`Đã tải cấu hệ thống thành công${BOT_TAG} (privacy guard: bật)`, "info");
    // deploy cloud (Render/Koyeb...): khôi phục account/cookie/db từ env trước khi login
    bootstrapFiles();
    // mở health server TRƯỚC login: cloud platform cần port mở ngay
    startHealthServer();
} catch (error) {
    logger.log(`Lỗi khi đọc config: ${error instanceof Error ? error.message : String(error)}`, "error");
    process.exit(1);
}

const tempFolderCommand = path.join(__dirname, "..", "..", "plugins", "commands", "temp");
const tempFolderEvent = path.join(__dirname, "..", "..", "plugins", "events", "temp");

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
  logger.log(`Lỗi khi dọn folder temp: ${error instanceof Error ? error.message : String(error)}`, "error");
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

schedule.scheduleJob("0 * * * * *", () => {
    cleanOldMessages();
});

// Snapshot trạng thái ban đầu cho panel trước khi bắt đầu đăng nhập (best-effort)
try {
  db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
    loginState: getLoginState() || "starting",
    status: "starting",
    loginMessage: "Đang khởi động...",
    updatedAt: Date.now()
  });
} catch { /* best effort */ }

// Heartbeat nhẹ trước khi đăng nhập xong: ghi trạng thái đăng nhập hiện tại
// mỗi ~10s để panel thấy tiến độ, chỉ ghi khi trạng thái thay đổi (tránh ghi trùng).
let loginStatsTimer: NodeJS.Timeout | null = null;
let lastLoginStatState: string | null = null;
function refreshLoginStats(): void {
  try {
    const state = getLoginState();
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
    if (loginStatsTimer) clearInterval(loginStatsTimer);
    loginStatsTimer = null;
    return;
  }
  refreshLoginStats();
}, 10000);
if (loginStatsTimer?.unref) loginStatsTimer.unref();

let api;
try {
  api = await login();
} catch (error) {
  logger.log(`Lỗi khởi động đăng nhập${BOT_TAG}: ${error instanceof Error ? error.message : String(error)}`, "error");
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

if (getLoginState() !== "logged_in") {
    setLoginState("logged_in");
}

logger.log("Đã đăng nhập thành công", "info");

// Supabase: đợi đồng bộ mirror xong mới xử lý tin (tránh mất settings nhóm)
try {
  await db.ready?.();
} catch (error) {
  logger.log(`Chưa đồng bộ được database: ${error instanceof Error ? error.message : String(error)}`, "warn");
}

await loaderCommand();
await loaderEvent();

if (global.config.hot_reload) {
  hotReload.start();
}

// Gửi thống kê (hồ sơ, bạn bè, nhóm) lên store để panel hiển thị
const STATS_INTERVAL = 30000;
const sendStats = async (): Promise<void> => {
  if (!global.api) return;
  try {
    const data = await stats.collectStats(global.api);
    db.saveData("BotStats", "name", process.env.JT_BOT_NAME || "main", {
      ...data,
      status: global.api ? "online" : "starting",
      loginState: getLoginState() || (global.api ? "logged_in" : "unknown"),
      updatedAt: Date.now()
    });
  } catch (error) {
    logger.log(`Không gửi được thống kê: ${error instanceof Error ? error.message : String(error)}`, "warn");
  }
};
sendStats();
setInterval(sendStats, STATS_INTERVAL).unref();

listener(api);

// Cầu nói panel (chat Zalo thu nhỏ) — server nội bộ localhost
import("./shared/events/panelBridge").then(({ start }) => {
  start({
    api,
    port: Number(process.env.JT_BRIDGE_PORT) || 3901,
    token: process.env.JT_BRIDGE_TOKEN || global.config?.panel?.bridge_token || global.config?.panel?.token
  }).catch(() => { /* hỏng bridge không được làm chết bot */ });
}).catch(() => {});

// Lazy preload heavy modules in background (jimp, cheerio, canvas, axios, ...)
// so first-use commands feel instant. Non-blocking, does not hold the process.
lazyLoader.preloadHeavy();

})();
