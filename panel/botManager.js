const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const logger = require("../utils/logger");

const ROOT = path.join(__dirname, "..");
const PERSISTENT_DIR = String(process.env.JT_PERSISTENT_DIR || process.env.JT_DB_PERSISTENT_PATH || "").trim();
const PERSISTENT_ROOT = PERSISTENT_DIR ? path.resolve(PERSISTENT_DIR) : ROOT;
const BOTS_DIR = path.join(PERSISTENT_ROOT, "bots");
const REGISTRY_FILE = path.join(PERSISTENT_ROOT, "data", "bots.json");
const LEGACY_BOTS_DIR = path.join(ROOT, "bots");
const LEGACY_REGISTRY_FILE = path.join(ROOT, "data", "bots.json");

const MAX_LOG_LINES = 400;
const SIGKILL_DELAY = 5000;
const RESTART_DELAY_MS = 3000;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_RESTARTS_IN_WINDOW = 5;
const MAX_RESTART_DELAY_MS = 60000;
const STABLE_RUNTIME_RESET_MS = 5 * 60 * 1000;

function ensureDirs() {
  fs.mkdirSync(BOTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
}

function migrateFileIfMissing(source, destination) {
  if (!source || !destination || path.resolve(source) === path.resolve(destination)) return false;
  if (!fs.existsSync(source) || fs.existsSync(destination)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return true;
}

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// A legacy single-bot install kept account.json/cookie.json beside JohnTran.js.
// Panel mode runs the main bot from bots/main, so copy that session once when
// the bot-specific account does not exist. Never overwrite a child session.
function migrateLegacyMainSession(targetPaths = botPaths("main"), options = {}) {
  const configured = options.sourceAccountFile ||
    process.env.JT_ACCOUNT_FILE ||
    global.config?.account_file ||
    "account.json";
  const sourceAccount = path.isAbsolute(String(configured))
    ? String(configured)
    : path.resolve(ROOT, String(configured));
  const targetAccount = targetPaths.accountFile || path.join(targetPaths.dir, "account.json");

  if (fs.existsSync(targetAccount) || !fs.existsSync(sourceAccount)) return [];
  fs.mkdirSync(path.dirname(targetAccount), { recursive: true });

  let account;
  try {
    account = JSON.parse(fs.readFileSync(sourceAccount, "utf8"));
  } catch (error) {
    logger.log(`Không thể đọc account.json cũ để chuyển phiên bot main: ${error.message}`, "warn");
    return [];
  }
  if (!account || typeof account !== "object" || Array.isArray(account)) return [];

  const copied = [];
  const cookieName = typeof account.cookie === "string" && account.cookie.trim()
    ? account.cookie.trim()
    : "cookie.json";

  if (!path.isAbsolute(cookieName)) {
    const sourceCookie = path.resolve(path.dirname(sourceAccount), cookieName);
    let targetCookie = path.resolve(path.dirname(targetAccount), cookieName);

    // Never allow a relative cookie path to escape the per-bot directory.
    if (!isInsideDirectory(targetCookie, targetPaths.dir)) {
      targetCookie = path.join(targetPaths.dir, "cookie.json");
      account.cookie = "cookie.json";
    }

    if (fs.existsSync(sourceCookie) && !fs.existsSync(targetCookie)) {
      try {
        fs.mkdirSync(path.dirname(targetCookie), { recursive: true });
        fs.copyFileSync(sourceCookie, targetCookie, fs.constants.COPYFILE_EXCL);
        copied.push(path.relative(targetPaths.dir, targetCookie));
      } catch (error) {
        logger.log(`Không thể chuyển cookie cũ cho bot main: ${error.message}`, "warn");
        return [];
      }
    }
  }

  try {
    if (account.cookie !== cookieName) {
      fs.writeFileSync(targetAccount, JSON.stringify(account, null, 2), { flag: "wx" });
    } else {
      fs.copyFileSync(sourceAccount, targetAccount, fs.constants.COPYFILE_EXCL);
    }
    copied.push("account.json");
    logger.log("Đã chuyển phiên Cookie + IMEI cũ vào bots/main (không ghi đè phiên đã có).", "info");
    return copied;
  } catch (error) {
    for (const file of copied) {
      try { fs.unlinkSync(path.join(targetPaths.dir, file)); } catch {}
    }
    logger.log(`Không thể chuyển account.json cũ cho bot main: ${error.message}`, "warn");
    return [];
  }
}

function readRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    }
    if (PERSISTENT_ROOT !== ROOT && fs.existsSync(LEGACY_REGISTRY_FILE)) {
      const registry = JSON.parse(fs.readFileSync(LEGACY_REGISTRY_FILE, "utf8"));
      migrateFileIfMissing(LEGACY_REGISTRY_FILE, REGISTRY_FILE);
      logger.log("Đã sao chép registry bot cũ sang JT_PERSISTENT_DIR; giữ nguyên file nguồn.", "info");
      return registry;
    }
  } catch (error) {
    logger.log(`Không thể đọc registry bot: ${error.message}`, "error");
    throw new Error(`Registry bot bị lỗi; từ chối khởi tạo danh sách rỗng để tránh mất cấu hình: ${error.message}`);
  }
  return { bots: {} };
}

function writeRegistry(registry) {
  ensureDirs();
  const tmpFile = `${REGISTRY_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(registry, null, 2), "utf8");
    fs.renameSync(tmpFile, REGISTRY_FILE);
  } catch (error) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw error;
  }
}

function migrateLegacyBotFiles(name, targetPaths = botPaths(name)) {
  fs.mkdirSync(targetPaths.dir, { recursive: true });
  const copied = [];

  // Prefer an existing per-bot session. Only fall back to the old root-level
  // account/cookie when bots/main has no account yet.
  if (PERSISTENT_ROOT !== ROOT) {
    const legacyDir = path.join(LEGACY_BOTS_DIR, name);
    if (fs.existsSync(legacyDir)) {
      for (const file of ["store.json", "account.json", "cookie.json", "qr.png"]) {
        if (migrateFileIfMissing(path.join(legacyDir, file), path.join(targetPaths.dir, file))) copied.push(file);
      }

      // Preserve a custom relative cookie file referenced by legacy account.json.
      try {
        const account = JSON.parse(fs.readFileSync(path.join(legacyDir, "account.json"), "utf8"));
        const cookie = typeof account?.cookie === "string" ? account.cookie : "";
        if (cookie && !path.isAbsolute(cookie)) {
          const source = path.resolve(legacyDir, cookie);
          const relative = path.relative(path.resolve(legacyDir), source);
          if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
            if (migrateFileIfMissing(source, path.join(targetPaths.dir, relative))) copied.push(relative);
          }
        }
      } catch { /* tài khoản có thể chưa có file hoặc dùng cookie path tuyệt đối */ }
    }
  }

  if (name === "main") copied.push(...migrateLegacyMainSession(targetPaths));

  if (copied.length) {
    logger.log(`Đã chuyển dữ liệu/phiên bot '${name}': ${copied.join(", ")}. Giữ nguyên file nguồn.`, "info");
  }
  return copied;
}

function botDir(name) {
  return path.join(BOTS_DIR, name);
}

function getStorageLayout() {
  const { getJsonPersistenceStatus } = require("../core/storage/diagnostics");
  return {
    configuredRoot: PERSISTENT_ROOT,
    registryFile: REGISTRY_FILE,
    botsRoot: BOTS_DIR,
    persistence: getJsonPersistenceStatus(REGISTRY_FILE)
  };
}

function botPaths(name) {
  const dir = botDir(name);
  return {
    dir,
    dbFile: path.join(dir, "store.json"),
    accountFile: path.join(dir, "account.json"),
    qrFile: path.join(dir, "qr.png"),
    errorLogFile: path.join(dir, "logs", "errors.jsonl")
  };
}

class BotInstance {
  constructor(name, options = {}) {
    // Cổng cầu nối chat nội bộ — bot con tăng dần từ 3902
    this.bridgePort = Number(options.bridgePort) || (name === "main" ? 3901 : 0);
    this.bridgeToken = options.bridgeToken || "";
    this.name = name;
    this.autoRestart = options.autoRestart !== false;
    this.process = null;
    this.startedAt = null;
    this.stoppedByUser = false;
    this.restarts = 0;
    this.flapping = false;
    this.logs = [];
    this.restartTimer = null;
    this.restarting = false;
    this.restartHistory = [];
    this.restartAttempt = 0;
    this.nextRestartAt = null;
    this.lastExitAt = null;
    this.lastExitReason = null;
    this.restartDelayMs = Number.isFinite(Number(options.restartDelayMs))
      ? Math.max(0, Number(options.restartDelayMs))
      : RESTART_DELAY_MS;
    this.restartWindowMs = Number.isFinite(Number(options.restartWindowMs))
      ? Math.max(1, Number(options.restartWindowMs))
      : RESTART_WINDOW_MS;
    this.maxRestartDelayMs = Number.isFinite(Number(options.maxRestartDelayMs))
      ? Math.max(this.restartDelayMs, Number(options.maxRestartDelayMs))
      : MAX_RESTART_DELAY_MS;
    this.stableRuntimeResetMs = Number.isFinite(Number(options.stableRuntimeResetMs))
      ? Math.max(1, Number(options.stableRuntimeResetMs))
      : STABLE_RUNTIME_RESET_MS;
    this.maxRestartsInWindow = Number.isInteger(options.maxRestartsInWindow)
      ? Math.max(0, options.maxRestartsInWindow)
      : MAX_RESTARTS_IN_WINDOW;
    this.spawnProcess = typeof options.spawnProcess === "function" ? options.spawnProcess : spawn;
  }

  get status() {
    if (this.process && !this.process.killed) return "online";
    if (this.stoppedByUser) return "stopped";
    if (this.restarting) return "restarting";
    return "offline";
  }

  get pid() {
    return this.process?.pid || null;
  }

  pushLog(line) {
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
  }

  pruneRestartHistory(now = Date.now()) {
    const cutoff = now - this.restartWindowMs;
    this.restartHistory = this.restartHistory.filter((timestamp) => timestamp > cutoff);
    this.flapping = this.restartHistory.length > this.maxRestartsInWindow;
    return this.restartHistory.length;
  }

  cancelScheduledRestart() {
    if (!this.restartTimer) return false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.nextRestartAt = null;
    this.restarting = false;
    return true;
  }

  scheduleRestart(delayMs = this.restartDelayMs, { allowFlapping = false } = {}) {
    if (this.restartTimer || this.stoppedByUser || !this.autoRestart || (this.flapping && !allowFlapping)) return false;

    this.restarting = true;
    this.nextRestartAt = Date.now() + Math.max(0, delayMs);
    const timer = setTimeout(() => {
      if (this.restartTimer !== timer) return;
      this.restartTimer = null;
      this.nextRestartAt = null;
      this.restarting = false;

      // Re-check flags at execution time: Stop or disabling auto-restart may
      // have happened while this timer was waiting.
      if (this.stoppedByUser || !this.autoRestart || this.process) return;
      logger.log(`Watchdog đang khởi động lại bot '${this.name}' sau sự cố.`, "warn", { source: "bot-restart-auto", bot: this.name });
      try {
        this.start();
      } catch (error) {
        this.pushLog(`[watchdog] Không thể tự khởi động lại: ${error.message || error}`);
        logger.log(`Không thể tự khởi động lại bot '${this.name}': ${error.message || error}`, "error", { source: "bot-manager", bot: this.name });
      }
    }, Math.max(0, delayMs));
    this.restartTimer = timer;
    return true;
  }

  setAutoRestart(value) {
    this.autoRestart = Boolean(value);
    if (!this.autoRestart) this.cancelScheduledRestart();
    return this;
  }

  start() {
    if (this.process) {
      throw new Error(`Bot '${this.name}' đang chạy`);
    }
    this.cancelScheduledRestart();
    this.pruneRestartHistory();
    const paths = botPaths(this.name);
    migrateLegacyBotFiles(this.name, paths);
    fs.mkdirSync(paths.dir, { recursive: true });

    const env = {
      ...process.env,
      JT_BOT_NAME: this.name,
      JT_DB_FILE: paths.dbFile,
      JT_ERROR_LOG_FILE: paths.errorLogFile,
      JT_ACCOUNT_FILE: paths.accountFile,
      JT_QRCODE_PATH: paths.qrFile,
      JT_PANEL_CHILD: "1",
      JT_SUPABASE_SYNC: "1",
      JT_BRIDGE_PORT: String(this.bridgePort || 3901),
      // Token bảo vệ cầu nối panel↔bot: bot con dùng GIỐNG panel proxy.
      // (JT_PANEL__TOKEN bị xoá dưới đây — token panel ≠ token bridge.)
      ...(this.bridgeToken ? { JT_BRIDGE_TOKEN: String(this.bridgeToken) } : {}),
      // Chuẩn bị sẵn phiên đăng nhập cho bot con (nếu host set sẵn qua env)
      ...(process.env.JT_ACCOUNT_JSON ? { JT_ACCOUNT_JSON: process.env.JT_ACCOUNT_JSON } : {}),
      ...(process.env.JT_COOKIE_JSON ? { JT_COOKIE_JSON: process.env.JT_COOKIE_JSON } : {})
    };
    // Bot con KHÔNG mở panel/health riêng và không chiếm PORT của master
    // (panel + health do master lo; tránh tranh giật cổng trên Koyeb)
    delete env.PORT;
    delete env.JT_PANEL__ENABLED;
    delete env.JT_PANEL__TOKEN;
    delete env.JT_PANEL__PORT;

    const child = this.spawnProcess(process.execPath, [path.join(ROOT, "JohnTran.js")], {
      cwd: ROOT,
      env,
      // IPC lets the child report the actual bridge port when its preferred port is occupied.
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });

    this.process = child;
    this.startedAt = Date.now();

    child.on?.("message", (message) => {
      if (!message || message.type !== "jt:panel-bridge-ready") return;
      const actualPort = Number(message.port);
      if (!Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65535) return;
      const previousPort = this.bridgePort;
      this.bridgePort = actualPort;
      this.pushLog(`[bridge] Panel bridge sẵn sàng tại 127.0.0.1:${actualPort}`);
      if (previousPort !== actualPort) {
        logger.log(`Bot con '${this.name}' cập nhật bridge port ${previousPort} → ${actualPort}.`, "info", {
          source: "bot-bridge-ready", bot: this.name
        });
      }
    });
    this.stoppedByUser = false;

    const prefix = `[${this.name}]`;
    child.stdout.on("data", (data) => {
      const text = data.toString();
      this.pushLog(text.replace(/\n$/, ""));
      process.stdout.write(`${prefix} ${text}`);
    });
    child.stderr.on("data", (data) => {
      const text = data.toString();
      this.pushLog(text.replace(/\n$/, ""));
      process.stdout.write(`${prefix} ${text}`);
    });
    child.once("error", (error) => {
      this.pushLog(`[system] không thể tạo tiến trình: ${error.message || error}`);
      logger.log(`Không thể tạo tiến trình bot '${this.name}': ${error.message || error}`, "error", { source: "bot-manager", bot: this.name });
      // ChildProcess emits close after a spawn error; lifecycle cleanup and
      // restart scheduling happen in the single close handler below.
    });

    child.once("close", (code, signal) => {
      if (this.process === child) this.process = null;

      const wasStoppedByUser = this.stoppedByUser;
      const exitLabel = signal ? `signal ${signal}` : `code ${code}`;
      const runtimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
      this.lastExitAt = Date.now();
      this.lastExitReason = exitLabel;
      if (runtimeMs >= this.stableRuntimeResetMs) {
        // A long stable run breaks the consecutive restart backoff, while the
        // rolling window still protects against frequent crashes.
        this.restartAttempt = 0;
      }
      this.pushLog(`[system] tiến trình thoát với ${exitLabel}`);
      logger.log(`Bot con '${this.name}' thoát (${exitLabel})`, wasStoppedByUser ? "info" : "warn", { source: "bot-lifecycle", bot: this.name });

      // A manual Stop is not a crash and must not consume the crash budget.
      if (wasStoppedByUser) {
        this.restarting = false;
        return;
      }

      this.restarts += 1;
      this.restartHistory.push(Date.now());
      const restartCount = this.pruneRestartHistory();

      if (this.autoRestart && restartCount <= this.maxRestartsInWindow) {
        this.restartAttempt = Math.min(10, this.restartAttempt + 1);
        const delay = Math.min(this.restartDelayMs * (2 ** (this.restartAttempt - 1)), this.maxRestartDelayMs);
        this.scheduleRestart(delay);
      } else if (this.autoRestart) {
        const oldestCrashAt = this.restartHistory[0] || Date.now();
        const cooldownMs = Math.max(
          this.restartDelayMs,
          oldestCrashAt + this.restartWindowMs - Date.now() + 1
        );
        this.restartAttempt = 0;
        this.pushLog("[watchdog] Bot crash liên tục; tạm nghỉ đến khi cửa sổ giới hạn được làm mới");
        logger.log(`Watchdog tạm hoãn bot '${this.name}': ${restartCount} lần thoát trong ${Math.round(this.restartWindowMs / 60000)} phút; sẽ tự thử lại sau ${Math.ceil(cooldownMs / 1000)}s`, "error", { source: "bot-watchdog", bot: this.name });
        this.scheduleRestart(cooldownMs, { allowFlapping: true });
      }
    });

    logger.log(`Đã khởi động bot con '${this.name}' (pid ${child.pid})`, "info");
    return child.pid;
  }

  async stop() {
    this.stoppedByUser = true;
    const cancelledRestart = this.cancelScheduledRestart();
    const child = this.process;
    if (!child) return cancelledRestart;

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (this.process === child) this.process = null;
        resolve(true);
      };
      const killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, SIGKILL_DELAY);

      child.once("close", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  }

  async restart() {
    logger.log(`Có yêu cầu restart thủ công bot '${this.name}'.`, "warn", { source: "bot-restart-manual", bot: this.name });
    await this.stop();
    this.restartAttempt = 0;
    this.stoppedByUser = false;
    return this.start();
  }

  toJSON() {
    this.pruneRestartHistory();
    const processStatus = this.status;
    return {
      name: this.name,
      status: processStatus,
      processStatus,
      loginState: null,
      pid: this.pid,
      autoRestart: this.autoRestart,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      restarts: this.restarts,
      flapping: this.flapping,
      restartCountInWindow: this.restartHistory.length,
      restartAttempt: this.restartAttempt,
      nextRestartAt: this.nextRestartAt,
      lastExitAt: this.lastExitAt,
      lastExitReason: this.lastExitReason,
      hasQr: fs.existsSync(botPaths(this.name).qrFile),
      lastLogs: this.logs.slice(-20),
      bridgePort: this.bridgePort || 3901
    };
  }
}

class BotManager {
  constructor(options = {}) {
    this.bridgeToken = options.bridgeToken || "";
    this.bots = new Map();
    ensureDirs();
    const registry = readRegistry();
    for (const name of Object.keys(registry.bots || {})) {
      this.bots.set(name, new BotInstance(name, { ...registry.bots[name], bridgeToken: this.bridgeToken }));
    }
  }

  // Gọi từ panel/server.startPanel để đảm bảo cùng 1 token (proxy ↔ bot con).
  setBridgeToken(token) {
    this.bridgeToken = String(token || "");
    for (const bot of this.bots.values()) bot.bridgeToken = this.bridgeToken;
  }

  list() {
    return [...this.bots.values()].map((bot) => bot.toJSON());
  }

  // Rehydrate every registered bot after a Panel master restart/redeploy.
  // Registry membership is the desired set of managed instances; process
  // objects themselves are intentionally not persisted across deployments.
  startAll() {
    const started = [];
    const skipped = [];
    const errors = [];
    for (const bot of this.bots.values()) {
      if (bot.process) {
        skipped.push(bot.name);
        continue;
      }
      try {
        bot.start();
        started.push(bot.name);
      } catch (error) {
        errors.push({ name: bot.name, error: error.message || String(error) });
        logger.log(`Không thể tự khởi động bot đã đăng ký '${bot.name}': ${error.message || error}`, "error", { source: "bot-manager-autostart", bot: bot.name });
      }
    }
    return { started, skipped, errors };
  }

  get(name) {
    return this.bots.get(name) || null;
  }

  create(name, options = {}) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
      throw new Error("Tên bot chỉ được chứa chữ, số, gạch ngang, gạch dưới (tối đa 32 ký tự)");
    }
    if (this.bots.has(name)) {
      throw new Error(`Bot '${name}' đã tồn tại`);
    }
    let bridgePort = options.bridgePort;
    if (!bridgePort) {
      // cấp cổng trống tiếp theo từ 3902
      bridgePort = 3902;
      const used = new Set([3901, ...[...this.bots.values()].map((b) => b.bridgePort).filter(Boolean)]);
      while (used.has(bridgePort)) bridgePort += 1;
    }
    const bot = new BotInstance(name, { ...options, bridgePort, bridgeToken: this.bridgeToken });
    this.bots.set(name, bot);
    this.persist();
    return bot;
  }

  async remove(name) {
    const bot = this.bots.get(name);
    if (!bot) return false;
    await bot.stop();
    this.bots.delete(name);
    this.persist();
    fs.rmSync(botDir(name), { recursive: true, force: true });
    return true;
  }

  setAutoRestart(name, value) {
    const bot = this.bots.get(name);
    if (!bot) throw new Error(`Bot '${name}' không tồn tại`);
    bot.setAutoRestart(value);
    this.persist();
    return bot;
  }

  persist() {
    const registry = { bots: {} };
    for (const [name, bot] of this.bots.entries()) {
      registry.bots[name] = { name, autoRestart: bot.autoRestart, createdAt: Date.now() };
    }
    writeRegistry(registry);
  }

  async stopAll() {
    await Promise.all([...this.bots.values()].map((bot) => bot.stop()));
  }
}

module.exports = {
  BotManager,
  BotInstance,
  botPaths,
  botDir,
  BOTS_DIR,
  PERSISTENT_ROOT,
  getStorageLayout,
  _test: { migrateFileIfMissing, migrateLegacyBotFiles, migrateLegacyMainSession, readRegistry, writeRegistry }
};
