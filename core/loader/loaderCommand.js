const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { extractDependencies, installMissingDeps } = require("./pluginDeps");
const Users = require("../controller/controllerUsers");
const Threads = require("../controller/controllerThreads");

async function loadCommands(commandName = null) {
  const dir = path.join(__dirname, "../..", "plugins", "commands");
  let files;

  if (commandName) {
    const base = commandName.replace(/\.js$/, "");
    if (!/^[a-zA-Z0-9_-]+$/.test(base)) {
      logger.log(`Tên command không hợp lệ: ${commandName}`, "error");
      return { status: false, error: `Tên command không hợp lệ: ${commandName}` };
    }
    files = [`${base}.js`];
  } else {
    files = fs.readdirSync(dir).filter(file => file.endsWith(".js"));
  }

  let shouldRestart = false;

  var result = {};

  for (const file of files) {
    const filePath = path.join(dir, file);

    if (!fs.existsSync(filePath)) {
      logger.log(`Không tìm thấy file: ${file}`, "error");
      result = { status: false, error: `Không tìm thấy file: ${file}` };
      continue;
    }

    const resolved = path.resolve(filePath);
    const dirResolved = path.resolve(dir);
    if (!resolved.startsWith(dirResolved + path.sep)) {
      logger.log(`Phát hiện path traversal trong commandName: ${commandName}`, "error");
      result = { status: false, error: `Path traversal bị từ chối: ${commandName}` };
      continue;
    }

    const dependencies = extractDependencies(filePath, logger);
    const { shouldRestart: depRestart, errors: depErrors } = installMissingDeps(dependencies, path.join(__dirname, "../../"), logger);
    if (depRestart) shouldRestart = true;
    depErrors.forEach(e => logger.log(e, "error"));
    if (shouldRestart) continue;

    delete require.cache[require.resolve(filePath)];

    let command;
    try {
      command = require(filePath);
    } catch (err) {
      logger.log(`Không thể require file ${file}: ${err.message}`, "error");
      result = { status: false, error: `Không thể require file ${file}: ${err.message}` };
      continue;
    }

    if (!command.config || (!command.config.name && command.config.name !== '') || !command.config.cooldowns || typeof command.run !== "function") {
      logger.log(`Command ${file} không hợp lệ`, "warn");
      result = { status: false, error: `Command ${file} không hợp lệ` };
      continue;
    }

    const name = command.config.name.toLowerCase();
    global.client.commands.set(name, command);

    if (typeof command.onLoad === "function") {
      logger.log(`Đang chạy onLoad cho command ${name}`, "info");
      try {
        await command.onLoad({ api: global.api, Users, Threads });
      } catch (e) {
        logger.log(`Lỗi trong onLoad của command ${name}: ${e.message}`, "error");
        result = { status: false, error: `Lỗi trong onLoad của command ${name}: ${e.message}` };
        continue;
      }
    }
  }

  logger.log(
    commandName
      ? `Đã tải lại command "${commandName}"`
      : `Đã tải thành công ${global.client.commands.size} lệnh`,
    "info"
  );

  if (shouldRestart && commandName == null) {
    logger.log("Đã cài thêm package. Đang khởi động lại bot...", "warn");
    process.exit(2);
  } else {
    result = { status: true, restart: shouldRestart };
    return result;
  }
}

module.exports = loadCommands;
