"use strict";

const path = require("node:path");

const SOURCE_COMMIT = "745a7ad1d155d03bda4466a92e52c3c578f279ab";
const RAW_BASE_URL = "https://raw.githubusercontent.com/DEVTRAN07/Discord-decor/" + SOURCE_COMMIT;
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const ASSETS_DIR = path.join(REPOSITORY_ROOT, "src", "assets", "stk");
const MAX_FRAME_SIDE = 512;

module.exports = {
  SOURCE_COMMIT,
  RAW_BASE_URL,
  REPOSITORY_ROOT,
  ASSETS_DIR,
  MAX_FRAME_SIDE
};
