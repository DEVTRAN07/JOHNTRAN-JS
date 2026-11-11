const fs = require("fs");
const path = require("path");
const logger = require("./logger");

function updateConfigArray(key, newArray) {
    const configPath = path.join(__dirname, "..", "config.yml");
    const lines = fs.readFileSync(configPath, "utf8").split("\n");

    const updatedLines = [];
    let insideTargetArray = false;
    let indent = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!insideTargetArray) {
            const trimmed = line.trim();
            if (trimmed.startsWith(`${key}:`)) {
                insideTargetArray = true;
                indent = line.match(/^(\s*)/)[0];
                updatedLines.push(`${indent}${key}:`);
                newArray.forEach(item => {
                    updatedLines.push(`${indent}  - "${item}"`);
                });

                let j = i + 1;
                while (j < lines.length && lines[j].trim().startsWith("-")) {
                    j++;
                }

                i = j - 1;
            } else {
                updatedLines.push(line);
            }
        } else {
            updatedLines.push(line);
        }
    }

    fs.writeFileSync(configPath, updatedLines.join("\n"), "utf8");
}

function reloadConfig() {
    try {
        const configSystem = require("../core/config");
        const config = configSystem.load();
        global.config = config;
        global.users = {
            admin: config.admin_bot,
            support: config.support_bot
        };
        logger.log("Đã tải lại config (đầy đủ defaults + env override)", "info");
    } catch (error) {
        logger.log(`Loi khi doc config.yml: ${error.message || error}`, "error");
        process.exit(1);
    }
}

module.exports = {
    updateConfigArray,
    reloadConfig
};
