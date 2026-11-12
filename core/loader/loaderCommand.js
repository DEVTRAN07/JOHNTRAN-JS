const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { extractDependencies, installMissingDeps } = require("./pluginDeps");
const Users = require("../runtime/services/userService");
const Threads = require("../runtime/services/threadService");

const { invalidate: invalidateCommandRegistry } = require("../runtime/commandRegistry");
const { invalidateEventRegistry } = require("../runtime/eventRegistry");

async function loadCommands(commandName = null, options = {}) {
  const dir = options.dir || path.join(__dirname, "../..", "plugins", "commands");
  const log = options.logger || logger;
  const readDependencies = options.extractDependencies || extractDependencies;
  const installDependencies = options.installMissingDeps || installMissingDeps;
  const errors = [];
  let loaded = 0;
  let shouldRestart = false;
  let files;

  const recordError = (message, level = "error") => {
    errors.push(message);
    log.log(message, level);
  };

  if (commandName) {
    const base = String(commandName).replace(/\.js$/, "");
    if (!/^[a-zA-Z0-9_-]+$/.test(base)) {
      const message = "Tên command không hợp lệ: " + commandName;
      recordError(message);
      return { status: false, error: message, errors, loaded, restart: false };
    }
    files = [base + ".js"];
  } else {
    files = fs.readdirSync(dir).filter(file => file.endsWith(".js"));
  }

  for (const file of files) {
    const filePath = path.join(dir, file);

    if (!fs.existsSync(filePath)) {
      recordError("Không tìm thấy file: " + file);
      continue;
    }

    const resolved = path.resolve(filePath);
    const dirResolved = path.resolve(dir);
    const relative = path.relative(dirResolved, resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      recordError("Phát hiện path traversal trong commandName: " + commandName);
      continue;
    }

    const dependencies = readDependencies(filePath, log);
    const dependencyResult = installDependencies(
      dependencies,
      path.join(__dirname, "../../"),
      log
    );
    if (dependencyResult.shouldRestart) shouldRestart = true;
    for (const error of dependencyResult.errors || []) recordError(error);
    if (shouldRestart) continue;

    try {
      delete require.cache[require.resolve(filePath)];
    } catch {
      // A file can be new or have been removed from the cache.
    }

    let command;
    try {
      command = require(filePath);
    } catch (err) {
      recordError("Không thể require file " + file + ": " + err.message);
      continue;
    }

    if (
      !command?.config ||
      typeof command.config.name !== "string" ||
      typeof command.config.cooldowns !== "number" ||
      !Number.isFinite(command.config.cooldowns) ||
      command.config.cooldowns < 0 ||
      typeof command.run !== "function"
    ) {
      recordError("Command " + file + " không hợp lệ", "warn");
      continue;
    }

    const name = command.config.name.toLowerCase();
    const previousCommand = global.client.commands.get(name);
    global.client.commands.set(name, command);

    if (typeof command.onLoad === "function") {
      log.log("Đang chạy onLoad cho command " + name, "info");
      try {
        await command.onLoad({ api: global.api, Users, Threads });
      } catch (error) {
        if (previousCommand) global.client.commands.set(name, previousCommand);
        else global.client.commands.delete(name);
        recordError("Lỗi trong onLoad cho command " + name + ": " + error.message);
        continue;
      }
    }

    loaded++;
  }

  // Rebuild alias index lazily after initial load or hot reload.
  invalidateCommandRegistry(global.client.commands);
  invalidateEventRegistry(global.client.events);

  if (errors.length) {
    log.log(
      "Đã tải " + loaded + " lệnh; có " + errors.length + " lỗi cần kiểm tra",
      "warn"
    );
  } else {
    log.log(
      commandName
        ? 'Đã tải lại command "' + commandName + '"'
        : "Đã tải thành công " + global.client.commands.size + " lệnh",
      "info"
    );
  }

  if (shouldRestart && commandName == null) {
    log.log("Đã cài thêm package. Đang khởi động lại bot...", "warn");
    process.exit(2);
  }

  const result = {
    status: errors.length === 0,
    restart: shouldRestart,
    loaded,
    errors
  };
  if (errors.length) result.error = errors[0];
  return result;
}

module.exports = loadCommands;
