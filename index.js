const { spawn } = require("child_process");
const path = require("path");
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

        // Route /update from a Panel child through the master so every running
        // bot is stopped before tracked files are replaced. Restart only bots
        // that were running before the request; manually stopped bots stay off.
        let panelUpdateProcess = null;
        let panelUpdateInProgress = false;
        manager.setUpdateHandler(({ botName }) => {
          if (panelUpdateInProgress) return;
          panelUpdateInProgress = true;
          const restartNames = manager.list()
            .filter(bot => bot.status === "online" || bot.status === "restarting")
            .map(bot => bot.name);

          const restartPreviousBots = () => {
            for (const name of restartNames) {
              const bot = manager.get(name);
              if (!bot || bot.process) continue;
              try {
                bot.start();
              } catch (error) {
                logger.log("Không thể khởi động lại bot '" + name + "' sau update: " + (error.message || error), "error");
              }
            }
            panelUpdateProcess = null;
            panelUpdateInProgress = false;
          };

          void (async () => {
            logger.log("Panel nhận /update từ bot '" + botName + "'. Đang dừng bot con để cập nhật an toàn...", "info");
            try {
              await manager.stopAll();
            } catch (error) {
              logger.log("Lỗi khi dừng bot con trước update: " + (error.message || error), "error");
              restartPreviousBots();
              return;
            }

            let updater;
            try {
              updater = spawn(process.execPath, [path.join(__dirname, "scripts", "update.js")], {
                cwd: __dirname,
                stdio: "inherit",
                env: { ...process.env, JT_UPDATE_TRIGGER: "panel-zalo-command" }
              });
            } catch (error) {
              logger.log("Không thể chạy updater trong Panel: " + (error.message || error), "error");
              restartPreviousBots();
              return;
            }

            panelUpdateProcess = updater;
            let settled = false;
            const finish = (code, error = null) => {
              if (settled) return;
              settled = true;
              if (error) logger.log("Updater trong Panel gặp lỗi: " + (error.message || error), "error");
              if (code === 0) {
                logger.log("Panel cập nhật mã nguồn thành công; đang khởi động lại các bot trước đó.", "info");
              } else {
                logger.log("Panel cập nhật không hoàn tất; khởi động lại phiên bản hiện tại.", "warn");
              }
              restartPreviousBots();
            };
            updater.once("error", error => finish(1, error));
            updater.once("close", code => finish(code));
          })().catch(error => {
            logger.log("Luồng cập nhật Panel thất bại: " + (error.message || error), "error");
            restartPreviousBots();
          });
        });

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
            if (panelUpdateProcess && !panelUpdateProcess.killed) {
              try { panelUpdateProcess.kill("SIGTERM"); } catch {}
            }
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
    let updateProcess = null;

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

    function runUpdateAndRestart() {
        if (shuttingDown || updateProcess) return;
        logger.log("Bot đã dừng an toàn. Đang cập nhật mã nguồn từ GitHub main...", "info");
        let updater;
        try {
            updater = spawn(process.execPath, [path.join(__dirname, "scripts", "update.js")], {
                cwd: __dirname,
                stdio: "inherit",
                env: { ...process.env, JT_UPDATE_TRIGGER: "zalo-command" }
            });
        } catch (error) {
            logger.log("Không thể chạy updater: " + (error.message || error), "error");
            scheduleRestart(1000, "Không thể cập nhật; khởi động lại phiên bản hiện tại");
            return;
        }
        updateProcess = updater;
        updater.once("error", (error) => {
            logger.log("Updater gặp lỗi: " + (error.message || error), "error");
        });
        updater.once("close", (code) => {
            if (updateProcess === updater) updateProcess = null;
            if (shuttingDown) return;
            if (code === 0) {
                scheduleRestart(250, "Đã kiểm tra/cập nhật GitHub xong");
            } else {
                scheduleRestart(1000, "Cập nhật không hoàn tất; khởi động lại phiên bản hiện tại");
            }
        });
    }

    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        logger.log("Đang dừng bot con...", "warn");

        if (updateProcess && !updateProcess.killed) {
            try { updateProcess.kill("SIGTERM"); } catch {}
        }
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
                // IPC is reserved for trusted supervisor control messages such as /update.
                stdio: ["inherit", "inherit", "inherit", "ipc"],
                env: {
                    ...process.env,
                    JT_PANEL_CHILD: "0",
                    JT_UPDATE_SUPERVISOR: "1"
                }
            });
        } catch (error) {
            scheduleCrashRecovery(`Không thể tạo tiến trình bot con: ${error.message || error}`);
            return;
        }
        child = currentChild;
        let updateRequested = false;
        currentChild.on("message", (message) => {
            if (message && message.type === "jt:update-request") {
                updateRequested = true;
                logger.log("Đã nhận yêu cầu cập nhật từ lệnh Zalo /update.", "info");
            }
        });

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

            if (code === 3 && !signal && updateRequested) {
                runUpdateAndRestart();
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
