#!/usr/bin/env node
"use strict";

const stk = require("../core/stkDiscordService");

const status = stk.getAssetStatus();
console.log("STK Discord asset check");
console.log("Directory: " + status.directory);
console.log("Menu image: " + (status.menu.exists ? "OK" : "MISSING") + " (" + status.menu.path + ")");
console.log("Decoration frames: " + status.available + "/" + status.total + " ready");

if (status.missing.length) {
  console.log("");
  console.log("Missing frame assets:");
  for (const item of status.missing) {
    console.log("  #" + item.id + " " + item.name + " -> " + item.file);
  }
}

const complete = status.menu.exists && status.missingCount === 0;
console.log("");
console.log(complete
  ? "PASS: all STK Discord resources are ready."
  : "INCOMPLETE: copy the missing files into data/discord_decor/ and run this check again.");
process.exitCode = complete ? 0 : 1;
