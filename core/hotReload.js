const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { invalidate: invalidateCommandRegistry } = require("./runtime/commandRegistry");
const { invalidateEventRegistry } = require("./runtime/eventRegistry");

const COMMANDS_DIR = path.join(__dirname, "..", "plugins", "commands");
const EVENTS_DIR = path.join(__dirname, "..", "plugins", "events");
const DEBOUNCE_MS = 400;

let commandWatcher = null;
let eventWatcher = null;
const pending = new Map();

function registerCommand(filePath, { silent = true } = {}) {
  const fileName = path.basename(filePath, ".js");
  try {
    delete require.cache[require.resolve(filePath)];
    const plugin = require(filePath);
    if (
      !plugin?.config ||
      typeof plugin.config.name !== "string" ||
      typeof plugin.config.cooldowns !== "number" ||
      !Number.isFinite(plugin.config.cooldowns) ||
      plugin.config.cooldowns < 0 ||
      typeof plugin.run !== "function"
    ) {
      throw new Error("command không hợp lệ (cần config.name, config.cooldowns và run())");
    }

    const name = plugin.config.name.toLowerCase();
    global.client.commands.set(name, plugin);
    invalidateCommandRegistry(global.client.commands);
    if (!silent) logger.log("[hot-reload] Đã nạp lệnh '" + name + "'", "info");
    return name;
  } catch (error) {
    logger.log("[hot-reload] Lỗi nạp '" + fileName + "': " + error.message, "error");
    return null;
  }
}

function registerEvent(filePath, { silent = true } = {}) {
  const fileName = path.basename(filePath, ".js");
  try {
    delete require.cache[require.resolve(filePath)];
    const plugin = require(filePath);
    if (!plugin?.config?.name) throw new Error("plugin thiếu config.name");
    const name = plugin.config.name.toLowerCase();
    global.client.events.set(name, plugin);
    invalidateEventRegistry(global.client.events);
    if (!silent) logger.log("[hot-reload] Đã nạp event '" + name + "'", "info");
    return name;
  } catch (error) {
    logger.log("[hot-reload] Lỗi nạp '" + fileName + "': " + error.message, "error");
    return null;
  }
}

function handleChange(dir, type) {
  return (eventType, fileName) => {
    if (!fileName || !fileName.endsWith(".js")) return;
    const filePath = path.join(dir, fileName);
    const pendingKey = type + ":" + fileName;
    if (pending.has(pendingKey)) return;
    pending.set(pendingKey, setTimeout(() => {
      pending.delete(pendingKey);
      if (fs.existsSync(filePath)) {
        if (type === "command") registerCommand(filePath, { silent: false });
        else registerEvent(filePath, { silent: false });
      } else {
        // File deleted or renamed away: remove from collections + clear cache.
        const resolved = path.resolve(filePath);
        const cached = require.cache[resolved];
        const name = cached?.exports?.config?.name?.toLowerCase();
        if (name) {
          if (type === "command") {
            global.client.commands.delete(name);
            invalidateCommandRegistry(global.client.commands);
          } else {
            global.client.events.delete(name);
            invalidateEventRegistry(global.client.events);
          }
          logger.log("[hot-reload] Đã gỡ '" + name + "' (file " + fileName + " không còn tồn tại)", "info");
        }
        delete require.cache[resolved];
      }
    }, DEBOUNCE_MS));
  };
}

function start() {
  if (commandWatcher || eventWatcher) return commandWatcher || eventWatcher;
  try {
    commandWatcher = fs.watch(COMMANDS_DIR, handleChange(COMMANDS_DIR, "command"));
    // Keep a handle to both watchers so stop() cannot leak an event watcher.
    if (fs.existsSync(EVENTS_DIR)) {
      eventWatcher = fs.watch(EVENTS_DIR, handleChange(EVENTS_DIR, "event"));
    }
    logger.log("[hot-reload] Đang theo dõi thay đổi plugin (sửa file là tự nạp lại)", "info");
  } catch (error) {
    if (commandWatcher) commandWatcher.close();
    if (eventWatcher) eventWatcher.close();
    commandWatcher = null;
    eventWatcher = null;
    logger.log("[hot-reload] Không thể bật: " + error.message, "error");
  }
  return commandWatcher || eventWatcher;
}

function stop() {
  let stopped = false;
  for (const watcher of [commandWatcher, eventWatcher]) {
    if (!watcher) continue;
    try { watcher.close(); } catch {}
    stopped = true;
  }
  commandWatcher = null;
  eventWatcher = null;
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  if (stopped) logger.log("[hot-reload] Đã dừng theo dõi", "warn");
}

function reloadAll() {
  let count = 0;
  if (!fs.existsSync(COMMANDS_DIR)) return count;
  for (const file of fs.readdirSync(COMMANDS_DIR)) {
    if (file.endsWith(".js") && registerCommand(path.join(COMMANDS_DIR, file))) count++;
  }
  if (fs.existsSync(EVENTS_DIR)) {
    for (const file of fs.readdirSync(EVENTS_DIR)) {
      if (file.endsWith(".js") && registerEvent(path.join(EVENTS_DIR, file))) count++;
    }
  }
  return count;
}

module.exports = { start, stop, registerCommand };
