const fs = require("fs");
const path = require("path");
const logger = require("../../utils/logger");
const { extractDependencies, installMissingDeps } = require("./pluginDeps");

const Users = require("../controller/controllerUsers");
const Threads = require("../controller/controllerThreads");
const { invalidateEventRegistry } = require("../runtime/eventRegistry");

async function loadEvents(dir = path.join(__dirname, "../..", "plugins", "events")) {
  // Bot thuần lệnh: thư mục events có thể không tồn tại (git không theo dõi
  // thư mục rỗng → clone mới trên Render không có dir này). Thiếu dir = 0 event, không lỗi.
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.endsWith(".js")) : [];
  let shouldRestart = false;

  for (const file of files) {
    const filePath = path.join(dir, file);

    const dependencies = extractDependencies(filePath, logger);
    const { shouldRestart: depRestart, errors: depErrors } = installMissingDeps(dependencies, path.join(__dirname, "../../"), logger);
    if (depRestart) shouldRestart = true;
    depErrors.forEach(e => logger.log(e, "error"));

    if (shouldRestart) continue;

    let event;
    try {
      event = require(filePath);
    } catch (err) {
      logger.log(`Không thể require file ${file}: ${err.message}`, "error");
      continue;
    }

    if (
      !event.config ||
      !Array.isArray(event.config.event_type) ||
      typeof event.run !== "function"
    ) {
      logger.log(`Event ${file} không hợp lệ`, "warn");
      continue;
    }

    const eventName = event.config.name?.toLowerCase() || file.replace(/\.js$/, "");
    global.client.events.set(eventName, event);

    if (typeof event.onLoad === "function") {
      try {
        await event.onLoad({ api: global.api, Users, Threads });
      } catch (e) {
        logger.log(`Lỗi trong onLoad của event ${eventName}: ${e.message}`, "error");
      }
    }
  }

  invalidateEventRegistry(global.client.events);
  logger.log(`Đã tải ${global.client.events.size} event module`, "info");

  if (shouldRestart) {
    logger.log("Đã cài thêm package mới, đang khởi động lại bot...", "warn");
    process.exit(1);
  }
}

module.exports = loadEvents;