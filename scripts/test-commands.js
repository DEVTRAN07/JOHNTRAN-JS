/**
 * Test toàn bộ lệnh bot: kiểm tra cấu hình plugin + chạy qua pipeline handleCommand
 * với API giả lập. Dùng: node scripts/test-commands.js
 */
process.env.JT_DB_FILE = process.env.JT_DB_FILE || require("path").join(require("os").tmpdir(), "jt_test_store.json");

const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");

// dọn db test
const testDb = process.env.JT_DB_FILE;
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);

const configSystem = require(path.join(ROOT, "core/config"));
global.config = configSystem.load();

const YAML = require(path.join(ROOT, "node_modules/yaml"));

global.client = new Object({ commands: new Map(), events: new Map(), cooldowns: new Map() });
global.users = { admin: [], support: [] };
global.api = null;
global.data = { threadData: new Map() };

const logger = require(path.join(ROOT, "utils/logger"));
const { installAxiosGuard } = require(path.join(ROOT, "core/http/axios"));

const REQUIRED_FIELDS = ["name", "description", "category", "usage", "role", "cooldowns"];
const VALID_ROLES = [0, 1, 2];

const mockApi = () => {
  const state = { responses: [] };
  const handler = {
    get(target, prop) {
      if (prop === "__state") return state;
      if (state[prop]) return state[prop];
      const fn = async (...args) => {
        state.responses.push({ op: String(prop), args: args.slice(0, 1) });
        return null;
      };
      state[prop] = fn;
      return fn;
    }
  };
  return new Proxy({}, handler);
};

function makeEvent(overrides = {}) {
  return {
    threadId: "TEST_THREAD",
    type: 1,
    data: {
      uidFrom: "TEST_USER",
      msgId: "M1",
      cliMsgId: "C1",
      content: "",
      ...overrides.data
    },
    ...overrides
  };
}

async function runCommand(commandName, { args = [], withArgs = null } = {}) {
  const api = mockApi();
  const callArgs = withArgs || args;
  const handleCommand = require(path.join(ROOT, "core/handle/handleCommand"));
  const event = makeEvent();
  const prefix = global.config.prefix;
  // The command harness exercises plugins inside an explicitly enabled group.
  // Real groups without this persisted flag are intentionally OFF by default.
  await handleCommand(`${prefix}${commandName} ${callArgs.join(" ")}`.trim(), event, api, { bot_enabled: true }, prefix);
  return api.__state;
}

function validatePlugin(name, plugin, pluginType) {
  const errors = [];
  if (pluginType === "command") {
    for (const field of REQUIRED_FIELDS) {
      if (plugin.config?.[field] === undefined) errors.push(`thiếu field '${field}'`);
    }
    if (typeof plugin.run !== "function") errors.push("thiếu run()");
    if (plugin.config?.role !== undefined && !VALID_ROLES.includes(plugin.config.role)) {
      errors.push(`role không hợp lệ: ${plugin.config.role}`);
    }
    if (plugin.config?.cooldowns !== undefined && (typeof plugin.config.cooldowns !== "number" || plugin.config.cooldowns < 0)) {
      errors.push(`cooldowns không hợp lệ: ${plugin.config.cooldowns}`);
    }
  } else {
    if (!Array.isArray(plugin.config?.event_type)) errors.push("thiếu event_type");
    if (typeof plugin.run !== "function") errors.push("thiếu run()");
  }
  if (plugin.config?.dependencies && typeof plugin.config.dependencies !== "object") {
    errors.push("dependencies phải là object");
  }
  return errors;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms (${label})`)), ms))
  ]);
}

(async () => {
  installAxiosGuard();
  logger.log("=== TEST TOÀN BỘ LỆNH BOT ===", "info");

  const loaderCommand = require(path.join(ROOT, "core/loader/loaderCommand"));
  const loaderEvent = require(path.join(ROOT, "core/loader/loaderEvent"));

  await loaderCommand();
  await loaderEvent();

  const commands = [...global.client.commands.entries()];
  const events = [...global.client.events.entries()];

  const results = [];
  let passCount = 0;

  // Validate cấu hình
  for (const [name, plugin] of commands) {
    const errors = validatePlugin(name, plugin, "command");
    results.push({ name: `config:${name}`, ok: errors.length === 0, detail: errors.join(", ") });
  }
  for (const [name, plugin] of events) {
    const errors = validatePlugin(name, plugin, "event");
    results.push({ name: `config-event:${name}`, ok: errors.length === 0, detail: errors.join(", ") });
  }

  // Chạy pipeline mỗi lệnh
  for (const [name] of commands) {
    try {
      const state = await withTimeout(runCommand(name), 45000, name);
      const responded = state.responses.length > 0;
      results.push({ name: `run:${name}`, ok: responded, detail: responded ? `${state.responses.length} API call` : "không phản hồi!" });
    } catch (error) {
      results.push({ name: `run:${name}`, ok: false, detail: error.message });
    }
  }

  // In kết quả
  for (const result of results) {
    const status = result.ok ? "PASS" : "FAIL";
    if (result.ok) passCount++;
    logger.log(`${status}  ${result.name}${result.detail ? ` — ${result.detail}` : ""}`, result.ok ? "info" : "error");
  }

  logger.log(`=== KẾT QUẢ: ${passCount}/${results.length} PASS ===`, passCount === results.length ? "info" : "warn");

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    logger.log("Các mục thất bại:", "warn");
    for (const f of failed) logger.log(`  ✗ ${f.name}: ${f.detail}`, "error");
  }

  process.exit(failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS CRASHED:", error);
  process.exit(1);
});
