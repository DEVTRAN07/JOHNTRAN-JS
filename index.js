const { spawn } = require("child_process");
const logger = require("./utils/logger");
const semver = require("semver");
const configSystem = require("./core/config");

(async () => {
    await logger.printBanner();

    const nodeVersion = semver.parse(process.version);
    if (nodeVersion.major < 20) {
        logger.log(`Phiên bản Node.js ${process.version} không hỗ trợ. Vui lòng sử dụng Node.js 20 trở lên.`, "error");
        return process.exit(1);
    }

    let config;
    try {
        config = configSystem.load();
        global.config = config;
    } catch (error) {
        logger.log(`Lỗi cấu hình: ${error.message}`, "error");
        return process.exit(1);
    }

    const panelExplicitlyDisabled = process.env.JT_PANEL__ENABLED === "false" || process.env.JT_PANEL_ENABLED === "false";
    const cloudWantsPanel = !!(process.env.PORT || process.env.RENDER || process.env.RENDER_SERVICE_ID);
    const panelEnabled = !panelExplicitlyDisabled && (config.panel?.enabled || cloudWantsPanel);

    if (panelEnabled) {
        // ===== CHẾ ĐỘ PANEL: master quản lý, bot con chạy riêng từng tiến trình =====
        // Master panel không cần continuous sync loop — child bot owns sync.
        process.env.JT_SUPABASE_SYNC = "0";
        const { BotManager } = require("./panel/botManager");
        const { startPanel } = require("./panel/server");

        const manager = new BotManager({
          bridgeToken: config?.panel?.bridge_token || process.env.JT_BRIDGE_TOKEN || ""
        });
        startPanel({ manager, config });

        logger.log("Panel mode: dùng web panel để tạo và quản lý bot con", "info");
        console.log(`Bot con đã lưu: ${manager.list().map((b) => b.name).join(", ") || "(chưa có)"}`);

        // Deploy (Koyeb): tự tạo + chạy bot chính nếu chưa có bot con nào
        if (manager.list().length === 0) {
            try {
                const bot = manager.create("main");
                bot.start();
                logger.log("Đã tự khởi động bot con 'main' (xem QR trên panel hoặc qr.png)", "info");
            } catch (error) {
                logger.log(`Không thể tự khởi động bot main: ${error.message}`, "error");
            }
        }

        const shutdown = async () => {
            logger.log("Đang dừng tất cả bot con...", "warn");
            await manager.stopAll();
            process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
        return;
    }

    // ===== CHẾ ĐỘ BOT ĐƠN: master giám sát 1 tiến trình JohnTran.js =====
    let child = null;
    let shuttingDown = false;

    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.log("Đang dừng bot con...", "warn");

        if (!child) return process.exit(0);

        const currentChild = child;
        const forceStopTimer = setTimeout(() => {
            logger.log("Bot con chưa dừng sau 10 giây, buộc dừng", "warn");
            currentChild.kill("SIGKILL");
            process.exit(0);
        }, 10000);

        currentChild.once("close", () => {
            clearTimeout(forceStopTimer);
            process.exit(0);
        });
        currentChild.kill(signal);
    }

    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));

    function startProject() {
        if (shuttingDown) return;

        const currentChild = spawn(process.execPath, ["JohnTran.js"], {
            cwd: __dirname,
            stdio: "inherit",
            env: { ...process.env, JT_PANEL_CHILD: "0" }
        });
        child = currentChild;

        currentChild.on("error", (error) => {
            logger.log(`Không thể khởi động bot con: ${error.message}`, "error");
            process.exit(1);
        });

        currentChild.on("close", (code) => {
            if (child === currentChild) child = null;
            if (!shuttingDown && code === 2) {
                logger.log(`Khởi động lại...`, "warn");
                startProject();
            }
        });
    }

    startProject();
})();
