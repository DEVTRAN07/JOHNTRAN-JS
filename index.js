const { spawn } = require("child_process");
const logger = require("./utils/logger");
const semver = require("semver");
const configSystem = require("./core/config");
const { getRestartPlan } = require("./core/runtime/restartPolicy");

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
    const cloudWantsPanel = Boolean(process.env.PORT);
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

        // Registry là danh sách bot cần duy trì. Sau mỗi lần master restart,
        // ChildProcess cũ không còn nên phải khởi chạy lại tất cả bot đã lưu.
        if (manager.list().length === 0) {
            try {
                manager.create("main");
            } catch (error) {
                logger.log(`Không thể tạo bot main: ${error.message}`, "error");
            }
        }

        const bootResult = manager.startAll();
        if (bootResult.started.length) {
            logger.log(`Đã tự khởi động ${bootResult.started.length} bot: ${bootResult.started.join(", ")}`, "info");
        }
        if (bootResult.errors.length) {
            logger.log(`Có ${bootResult.errors.length} bot không thể tự khởi động; xem log từng bot trong Panel.`, "warn");
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
    let restartTimer = null;
    let restartHistory = [];

    function scheduleRestart(delayMs, reason) {
        if (shuttingDown || restartTimer) return false;
        logger.log(`${reason} — thử chạy lại sau ${Math.ceil(delayMs / 1000)}s`, "warn");
        restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!shuttingDown) startProject();
        }, Math.max(0, delayMs));
        return true;
    }

    function scheduleCrashRecovery(reason) {
        const plan = getRestartPlan(restartHistory, Date.now());
        restartHistory = plan.timestamps;
        if (plan.cooldown) {
            logger.log(
                `Supervisor tạm hoãn vì có ${plan.attempts} lần lỗi trong 10 phút; chờ cửa sổ giới hạn được làm mới`,
                "error"
            );
        }
        scheduleRestart(plan.delayMs, reason);
    }

    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
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
        if (shuttingDown || child) return;

        let currentChild;
        try {
            currentChild = spawn(process.execPath, ["JohnTran.js"], {
                cwd: __dirname,
                stdio: "inherit",
                env: { ...process.env, JT_PANEL_CHILD: "0" }
            });
        } catch (error) {
            scheduleCrashRecovery(`Không thể tạo tiến trình bot con: ${error.message || error}`);
            return;
        }
        child = currentChild;

        currentChild.once("error", (error) => {
            // Lỗi spawn thường được theo sau bởi close; để close handler thống nhất
            // việc tính backoff và quyết định thử lại.
            logger.log(`Không thể khởi động bot con: ${error.message || error}`, "error");
        });

        currentChild.once("close", (code, signal) => {
            if (child === currentChild) child = null;
            if (shuttingDown) return;

            if (code === 0 && !signal) {
                logger.log("Bot con đã thoát bình thường; supervisor không tự khởi động lại", "info");
                return;
            }

            // Mã 2 được dùng khi plugin cần restart sau khi cài dependency.
            if (code === 2 && !signal) {
                scheduleRestart(250, "Bot yêu cầu khởi động lại sau cập nhật dependency");
                return;
            }

            const reason = signal
                ? `Bot con thoát bất thường do signal ${signal}`
                : `Bot con thoát với code ${code}`;
            scheduleCrashRecovery(reason);
        });
    }

    startProject();
})();
