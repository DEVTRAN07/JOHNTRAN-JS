const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const logger = require("../utils/logger");

const ROOT = path.join(__dirname, "..");
const PERSISTENT_ROOT = String(process.env.JT_PERSISTENT_DIR || process.env.JT_DB_PERSISTENT_PATH || "").trim()
  ? path.resolve(process.env.JT_PERSISTENT_DIR)
  : ROOT;
const BOTS_DIR = path.join(PERSISTENT_ROOT, "bots");
const REGISTRY_FILE = path.join(PERSISTENT_ROOT, "data", "bots.json");
const LEGACY_BOTS_DIR = path.join(ROOT, "bots");
const LEGACY_REGISTRY_FILE = path.join(ROOT, "data", "bots.json");

const MAX_LOG_LINES = 400;
const SIGKILL_DELAY = 5000;
const RESTART_DELAY_MS = 3000;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const MAX_RESTARTS_IN_WINDOW = 5;

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
  if (PERSISTENT_ROOT === ROOT) return [];
  const legacyDir = path.join(LEGACY_BOTS_DIR, name);
  if (!fs.existsSync(legacyDir)) return [];
  fs.mkdirSync(targetPaths.dir, { recursive: true });

  const copied = [];
  for (const file of ["store.json", "account.json", "cookie.json", "qr.png"]) {
    if (migrateFileIfMissing(path.join(legacyDir, file), path.join(targetPaths.dir, file))) copied.push(file);
  }

  // Preserve a custom relative cookie file referenced by account.json.
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

  if (copied.length) {
    logger.log(`Đã sao chép dữ liệu bot '${name}' sang JT_PERSISTENT_DIR: ${copied.join(", ")}. Giữ nguyên file nguồn.`, "info");
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
    qrFile: path.join(dir, "qr.png")
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
    this.restartDelayMs = Number.isFinite(Number(options.restartDelayMs))
      ? Math.max(0, Number(options.restartDelayMs))
      : RESTART_DELAY_MS;
    this.restartWindowMs = Number.isFinite(Number(options.restartWindowMs))
      ? Math.max(1, Number(options.restartWindowMs))
      : RESTART_WINDOW_MS;
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
    this.restarting = false;
    return true;
  }

  scheduleRestart(delayMs = this.restartDelayMs, { allowFlapping = false } = {}) {
    if (this.restartTimer || this.stoppedByUser || !this.autoRestart || (this.flapping && !allowFlapping)) return false;

    this.restarting = true;
    const timer = setTimeout(() => {
      if (this.restartTimer !== timer) return;
      this.restartTimer = null;
      this.restarting = false;

      // Re-check flags at execution time: Stop or disabling auto-restart may
      // have happened while this timer was waiting.
      if (this.stoppedByUser || !this.autoRestart || this.process) return;
      try {
        this.start();
      } catch (error) {
        this.pushLog(`[watchdog] Không thể tự khởi động lại: ${error.message || error}`);
        logger.log(`Không thể tự khởi động lại bot '${this.name}': ${error.message || error}`, "error");
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
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.process = child;
    this.startedAt = Date.now();
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
      logger.log(`Không thể tạo tiến trình bot '${this.name}': ${error.message || error}`, "error");
      // ChildProcess emits close after a spawn error; lifecycle cleanup and
      // restart scheduling happen in the single close handler below.
    });

    child.once("close", (code, signal) => {
      if (this.process === child) this.process = null;

      const wasStoppedByUser = this.stoppedByUser;
      const exitLabel = signal ? `signal ${signal}` : `code ${code}`;
      this.pushLog(`[system] tiến trình thoát với ${exitLabel}`);
      logger.log(`Bot con '${this.name}' thoát (${exitLabel})`, wasStoppedByUser ? "info" : "warn");

      // A manual Stop is not a crash and must not consume the crash budget.
      if (wasStoppedByUser) {
        this.restarting = false;
        return;
      }

      this.restarts += 1;
      this.restartHistory.push(Date.now());
      const restartCount = this.pruneRestartHistory();

      if (this.autoRestart && restartCount <= this.maxRestartsInWindow) {
        this.scheduleRestart();
      } else if (this.autoRestart) {
        const oldestCrashAt = this.restartHistory[0] || Date.now();
        const cooldownMs = Math.max(
          this.restartDelayMs,
          oldestCrashAt + this.restartWindowMs - Date.now() + 1
        );
        this.pushLog("[watchdog] Bot crash liên tục; tạm nghỉ đến khi cửa sổ giới hạn được làm mới");
        logger.log(`Watchdog tạm hoãn bot '${this.name}': ${restartCount} lần thoát trong ${Math.round(this.restartWindowMs / 60000)} phút; sẽ tự thử lại sau ${Math.ceil(cooldownMs / 1000)}s`, "error");
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
    await this.stop();
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
  _test: { migrateFileIfMissing, migrateLegacyBotFiles, readRegistry, writeRegistry }
};
